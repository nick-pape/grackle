import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import { randomUUID } from "node:crypto";
import {
  createServiceCollector,
  startHeartbeat, getAdapter, setConnection, removeConnection,
  emit, subscribe, pushToEnv, attemptReconnects, resetReconnectState,
  parseAdapterConfig,
  ReconciliationManager,
  logger, exec, detectLanIp,
  runWithTrace, isValidTraceId, wrapAsyncIterableWithTrace,
} from "@grackle-ai/core";
import { createKnowledgePlugin, getKnowledgeReadinessCheck } from "@grackle-ai/plugin-knowledge";
import { loadPlugins, type PluginContext } from "@grackle-ai/plugin-sdk";
import { envRegistry, sessionStore, settingsStore, personaStore, workspaceStore, taskStore, sqlite, grackleHome, pluginStore } from "@grackle-ai/database";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { LocalPowerLineManager } from "./local-powerline-manager.js";
import { registerCrashHandlers } from "./crash-handler.js";
import { resolveServerConfig } from "./config.js";
import { createMcpServer, type ToolDefinition } from "@grackle-ai/mcp";
import {
  loadOrCreateApiKey, verifyApiKey, setAuthLogger,
  generatePairingCode,
  startSessionCleanup,
  startPairingCleanup,
  startOAuthCleanup,
} from "@grackle-ai/auth";
import { createWebServer, isWildcardAddress, type ReadinessResult } from "@grackle-ai/web-server";
import { createRequire } from "node:module";
import { initializeDatabase } from "./database-init.js";
import { registerAllAdapters } from "./adapter-registry.js";
import { bootstrapLocalEnvironment } from "./local-environment.js";
import { createCorePlugin } from "./core-plugin.js";
import { createSchedulingPlugin } from "@grackle-ai/plugin-scheduling";
import { createOrchestrationPlugin } from "@grackle-ai/plugin-orchestration";
import { setLoadedPluginNames } from "@grackle-ai/plugin-core";
import { createShutdown } from "./shutdown.js";

/** Require function for loading optional native modules (qrcode). */
const esmRequire: NodeRequire = createRequire(import.meta.url);

async function main(): Promise<void> {
  // Initialized to a no-op so server error handlers that fire before createShutdown()
  // don't throw. Replaced with the real shutdown function after all servers are created.
  let shutdown: () => Promise<void> = async () => {};

  // Resolve and validate all server configuration from env vars (fail fast on invalid values)
  const config = resolveServerConfig();
  logger.info({ config }, "Server configuration resolved");

  // Open the database, verify integrity, run schema migrations, then seed defaults
  initializeDatabase();

  // Configure auth logger to use the server's pino instance
  setAuthLogger(logger);

  // Load (or generate) the API key on startup
  const apiKey = loadOrCreateApiKey(grackleHome);

  // Register all built-in environment adapters
  registerAllAdapters();

  // Bootstrap the local environment (PowerLine + provisioning)
  const { powerLineManager: localPowerLineManager } = await bootstrapLocalEnvironment(
    {
      powerlinePort: config.powerlinePort,
      bindHost: config.host,
      skipLocalPowerline: config.skipLocalPowerline,
    },
    {
      envRegistry, settingsStore, personaStore, workspaceStore, taskStore,
      getAdapter, parseAdapterConfig, setConnection, pushToEnv,
      reconnectOrProvision, emit, resetReconnectState, logger,
      createPowerLineManager: (opts) => new LocalPowerLineManager(opts),
    },
  );

  // Non-blocking startup diagnostic: check gh CLI availability
  const GH_CHECK_TIMEOUT_MS: number = 5_000;
  exec("gh", ["version"], { timeout: GH_CHECK_TIMEOUT_MS })
    .then((result) => {
      logger.info(
        { version: result.stdout.split("\n")[0] },
        "GitHub CLI available",
      );
    })
    .catch((err: unknown) => {
      const isNotFound =
        err instanceof Error &&
        ("code" in err
          ? (err as Error & { code: unknown }).code === "ENOENT"
          : err.message.includes("ENOENT"));
      if (isNotFound) {
        logger.warn(
          "GitHub CLI (gh) not found on PATH — codespace features will be unavailable. Install from https://cli.github.com/",
        );
      } else {
        logger.warn(
          { err },
          "GitHub CLI (gh) availability check failed — codespace features may not work",
        );
      }
    });

  // Start heartbeat with auto-reconnect
  startHeartbeat(
    (environmentId) => {
      // Clean up the stale connection so the heartbeat doesn't keep probing it
      removeConnection(environmentId);
      envRegistry.updateEnvironmentStatus(environmentId, "disconnected");
      // Suspend any active sessions on this environment. The event-processor
      // catch block handles stream-level suspension for sessions with active
      // streams; this sweep catches edge cases (e.g., PENDING sessions).
      const activeSession = sessionStore.getActiveForEnv(environmentId);
      if (activeSession) {
        sessionStore.suspendSession(activeSession.id);
        if (activeSession.taskId) {
          emit("task.updated", { taskId: activeSession.taskId, workspaceId: "" });
        }
      }
      emit("environment.changed", {});
    },
    () => attemptReconnects(),
  );

  // Start periodic cleanup timers
  startPairingCleanup();
  startSessionCleanup();
  startOAuthCleanup();

  // --- Load plugins ---
  const pluginContext: PluginContext = {
    subscribe,
    emit,
    logger,
    config: {
      grpcPort: config.grpcPort,
      webPort: config.webPort,
      mcpPort: config.mcpPort,
      powerlinePort: config.powerlinePort,
      host: config.host,
      grackleHome,
      apiKey,
      skipRootAutostart: config.skipRootAutostart,
      workingDirectory: config.workingDirectory,
      worktreeBase: config.worktreeBase,
      dockerHost: config.dockerHost,
    },
  };

  // DB is the sole authority on plugin enabled state after initial seeding.
  // The ?? true fallback is defense-in-depth: should never trigger after seedDatabase() runs.
  const plugins = [createCorePlugin()];
  if (pluginStore.getPluginEnabled("orchestration") ?? true) {
    plugins.push(createOrchestrationPlugin());
  }
  if (pluginStore.getPluginEnabled("scheduling") ?? true) {
    plugins.push(createSchedulingPlugin());
  }
  if (pluginStore.getPluginEnabled("knowledge") ?? true) {
    plugins.push(createKnowledgePlugin());
  }
  const loaded = await loadPlugins(plugins, pluginContext);
  setLoadedPluginNames(new Set(loaded.pluginNames));

  // --- Wire gRPC handlers from plugins ---
  const collector = createServiceCollector();
  for (const reg of loaded.serviceRegistrations) {
    collector.addHandlers(reg.service, reg.handlers);
  }
  const routes = collector.buildRoutes();

  // --- Reconciliation Manager ---
  const reconciliationManager = new ReconciliationManager(loaded.reconciliationPhases);
  reconciliationManager.start();

  // --- gRPC server (HTTP/2) ---
  const grpcPort = config.grpcPort;
  const bindHost = config.host;
  const allowNetwork = isWildcardAddress(bindHost);

  /** Format bindHost for embedding in a URL — IPv6 literals need brackets per RFC 2732. */
  const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;
  const grpcHandler = connectNodeAdapter({
    routes,
    interceptors: [
      // Trace ID interceptor: extract or generate a trace ID for request correlation.
      // For streaming RPCs, wraps the response's message iterable so the generator
      // body runs within the trace context on each iteration step.
      (next) => async (req) => {
        const rawTraceId = req.header.get("x-trace-id") ?? undefined;
        const traceId = isValidTraceId(rawTraceId) ? rawTraceId! : randomUUID();
        const response = await runWithTrace(traceId, () => next(req));
        if ("stream" in response && response.stream) {
          const wrapped = wrapAsyncIterableWithTrace(traceId, response.message as AsyncIterable<unknown>);
          (response as { message: AsyncIterable<unknown> }).message = wrapped;
        }
        return response;
      },
      // Auth interceptor: validate Bearer token.
      (next) => async (req) => {
        const authHeader = req.header.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!verifyApiKey(token)) {
          throw new ConnectError("Unauthorized", Code.Unauthenticated);
        }
        return next(req);
      },
    ],
  });
  const grpcServer = http2.createServer(grpcHandler);

  grpcServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: grpcPort }, "Port %d is already in use. Is another Grackle server running?", grpcPort);
    } else {
      logger.fatal({ err }, "gRPC server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  grpcServer.listen(grpcPort, bindHost, () => {
    logger.info({ port: grpcPort, host: bindHost }, "gRPC server listening on http://%s:%d", urlHost, grpcPort);
  });

  // --- Web server (HTTP/1.1) ---
  const webPort = config.webPort;
  const mcpPort = config.mcpPort;
  const webServer = createWebServer({
    apiKey,
    webPort,
    bindHost,
    connectRoutes: routes,
    pluginNames: loaded.pluginNames,
    readinessCheck: (): ReadinessResult => {
      const checks: ReadinessResult["checks"] = {};
      try {
        sqlite!.prepare("SELECT 1").get();
        checks.database = { ok: true };
      } catch (err) {
        checks.database = { ok: false, message: err instanceof Error ? err.message : "unknown error" };
      }
      // Neo4j/knowledge is optional — exposed for operator visibility but does
      // not gate overall readiness. Only the database check is required.
      if (pluginStore.getPluginEnabled("knowledge") ?? true) {
        checks.knowledge = getKnowledgeReadinessCheck();
      }
      return {
        ready: checks.database.ok,
        checks,
      };
    },
  });

  webServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: webPort }, "Port %d is already in use. Is another Grackle server running?", webPort);
    } else {
      logger.fatal({ err }, "Web server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  webServer.listen(webPort, bindHost, () => {
    logger.info({ port: webPort, host: bindHost }, "Web UI on http://%s:%d", urlHost, webPort);

    // Generate initial pairing code and print to terminal
    const code = generatePairingCode();
    if (code) {
      const pairingHost = isWildcardAddress(bindHost)
        ? (detectLanIp() || "localhost")
        : bindHost;
      const pairingUrl = `http://${pairingHost}:${webPort}/pair?code=${code}`;

      process.stdout.write("\n");
      process.stdout.write("  Open in browser:\n");
      process.stdout.write(`  ${pairingUrl}\n`);
      process.stdout.write("\n");

      // Print QR code only when network-accessible (useful for phone scanning)
      if (allowNetwork) {
        try {
          const qrcode = esmRequire("qrcode") as { toString(text: string, opts: { type: string; small: boolean }): Promise<string> };
          qrcode.toString(pairingUrl, { type: "terminal", small: true })
            .then((qr: string) => { process.stdout.write(qr); })
            .catch(() => { /* QR rendering failed — not critical */ });
        } catch {
          // qrcode not installed — skip QR
        }
      }

      process.stdout.write("  Pairing code expires in 5 minutes.\n");
      process.stdout.write("  Run `grackle pair` to generate a new code.\n");
      process.stdout.write("\n");

      logger.info({ url: pairingUrl }, "Pairing URL generated");
    }
  });

  // --- MCP server (HTTP/1.1, Streamable HTTP) ---
  // Use dialable host for OAuth URLs (wildcard → 127.0.0.1)
  const dialableHost = isWildcardAddress(bindHost) ? "127.0.0.1" : bindHost;
  const dialableUrlHost = dialableHost.includes(":") ? `[${dialableHost}]` : dialableHost;
  const authServerUrl = `http://${dialableUrlHost}:${webPort}`;
  // Adapt plugin-contributed tools to the concrete ToolDefinition type expected by MCP.
  // Validates shape at startup so runtime failures surface immediately with a clear message.
  const pluginToolGroups: ToolDefinition[][] = loaded.mcpTools.length > 0
    ? [loaded.mcpTools.map((t) => {
        if (typeof (t.inputSchema as { safeParse?: unknown }).safeParse !== "function") {
          throw new Error(`Plugin tool "${t.name}": inputSchema must be a Zod schema (missing safeParse)`);
        }
        if (typeof t.handler !== "function") {
          throw new Error(`Plugin tool "${t.name}": handler must be a function`);
        }
        return t as unknown as ToolDefinition;
      })]
    : [];
  const mcpServer = createMcpServer({ bindHost, mcpPort, grpcPort, apiKey, authorizationServerUrl: authServerUrl, toolGroups: pluginToolGroups });

  mcpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: mcpPort }, "Port %d is already in use. Is another Grackle server running?", mcpPort);
    } else {
      logger.fatal({ err }, "MCP server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  mcpServer.listen(mcpPort, bindHost, () => {
    logger.info({ port: mcpPort, host: bindHost }, "MCP server on http://%s:%d/mcp", urlHost, mcpPort);
  });

  // --- Graceful shutdown ---
  shutdown = createShutdown({
    grpcServer,
    webServer,
    mcpServer,
    reconciliationManager,
    localPowerLineManager,
    pluginShutdown: loaded.shutdown,
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGINT", shutdown);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGTERM", shutdown);
}

// Register global crash handlers before main() so they catch errors during startup too.
registerCrashHandlers();

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
