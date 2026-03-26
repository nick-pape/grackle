import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import {
  registerGrackleRoutes,
  registerAdapter, startHeartbeat, getAdapter, setConnection, removeConnection,
  initSigchldSubscriber, initLifecycleManager,
  emit, subscribe,
  startTaskSession,
  pushToEnv, attemptReconnects, resetReconnectState,
  parseAdapterConfig, isKnowledgeEnabled, initKnowledge,
  computeTaskStatus,
  ReconciliationManager, createCronPhase, createOrphanPhase, findFirstConnectedEnvironment, lifecycleCleanupPhase,
  initOrphanReparentSubscriber,
  logger, exec, detectLanIp,
} from "@grackle-ai/core";
import { envRegistry, sessionStore, workspaceStore, taskStore, scheduleStore, personaStore, openDatabase, initDatabase, sqlite, seedDatabase, credentialProviders, grackleHome } from "@grackle-ai/database";
import { DockerAdapter } from "@grackle-ai/adapter-docker";
import { LocalAdapter } from "@grackle-ai/adapter-local";
import { SshAdapter } from "@grackle-ai/adapter-ssh";
import { CodespaceAdapter } from "@grackle-ai/adapter-codespace";
import { closeAllTunnels, reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_MCP_PORT, DEFAULT_POWERLINE_PORT, ROOT_TASK_ID, ROOT_TASK_INITIAL_PROMPT, DEFAULT_WORKSPACE_ID, TASK_STATUS } from "@grackle-ai/common";
import { LocalPowerLineManager } from "./local-powerline-manager.js";
import { createMcpServer } from "@grackle-ai/mcp";
import {
  loadOrCreateApiKey, verifyApiKey, setAuthLogger,
  generatePairingCode,
  startSessionCleanup, stopSessionCleanup,
  startPairingCleanup, stopPairingCleanup,
  startOAuthCleanup, stopOAuthCleanup,
  validateSessionCookie,
} from "@grackle-ai/auth";
import { createWebServer, isWildcardAddress } from "@grackle-ai/web-server";
import { createRequire } from "node:module";

/** Require function for loading optional native modules (qrcode). */
const esmRequire: NodeRequire = createRequire(import.meta.url);

/** Manager for local PowerLine lifecycle (start, stop, auto-restart). */
let localPowerLineManager: LocalPowerLineManager | undefined;

async function main(): Promise<void> {
  // Open the database, run schema migrations, then seed application defaults
  openDatabase();
  const { migrationErrors } = initDatabase();
  if (migrationErrors.length > 0) {
    logger.warn(
      { migrationNames: migrationErrors.map((m) => m.name), count: migrationErrors.length },
      "Database migrations completed with %d idempotent issue(s)",
      migrationErrors.length,
    );
  }
  seedDatabase(sqlite!);

  // Reset all environment statuses on startup — in-memory connections are lost
  envRegistry.resetAllStatuses();

  // Configure auth logger to use the server's pino instance
  setAuthLogger(logger);

  // Load (or generate) the API key on startup
  const apiKey = loadOrCreateApiKey(grackleHome);

  // Register adapters with server dependencies injected
  const adapterDeps = {
    exec,
    logger,
    isGitHubProviderEnabled: (): boolean => credentialProviders.getCredentialProviders().github !== "off",
  };
  registerAdapter(new DockerAdapter(adapterDeps));
  registerAdapter(new LocalAdapter());
  registerAdapter(new SshAdapter(adapterDeps));
  registerAdapter(new CodespaceAdapter(adapterDeps));

  // --- Auto-start local PowerLine ---
  const skipLocalPowerLine = process.env.GRACKLE_SKIP_LOCAL_POWERLINE === "1";
  const powerlinePort = parseInt(process.env.GRACKLE_POWERLINE_PORT || String(DEFAULT_POWERLINE_PORT), 10);
  const plBindHost = process.env.GRACKLE_HOST || "127.0.0.1";

  if (skipLocalPowerLine) {
    logger.info("Skipping local PowerLine auto-start (GRACKLE_SKIP_LOCAL_POWERLINE=1)");
  } else try {
    // Ensure the "local" environment exists in the database
    let localEnv = envRegistry.getEnvironment("local");
    const adapterConfig = JSON.stringify({ port: powerlinePort, host: plBindHost });

    if (localEnv) {
      // Update the adapter config to match the current port/host
      envRegistry.updateAdapterConfig("local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    } else {
      envRegistry.addEnvironment("local", "Local", "local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    }

    // Seed: ensure the default workspace exists (tied to the local environment).
    // The system task needs a workspace to resolve an environment for execution.
    const defaultWorkspace = workspaceStore.getWorkspace(DEFAULT_WORKSPACE_ID);
    if (!defaultWorkspace) {
      workspaceStore.createWorkspace(DEFAULT_WORKSPACE_ID, "Default", "", "", "local", false);
      logger.info("Created default workspace for local environment");
    } else if (defaultWorkspace.environmentId !== "local") {
      logger.warn(
        { workspaceId: DEFAULT_WORKSPACE_ID, environmentId: defaultWorkspace.environmentId },
        "Default workspace is not bound to local environment; skipping system task association",
      );
    }
    // Backfill: assign the default workspace to the system task if it has none.
    const systemTask = taskStore.getTask(ROOT_TASK_ID);
    const resolvedDefault = workspaceStore.getWorkspace(DEFAULT_WORKSPACE_ID);
    if (systemTask && !systemTask.workspaceId && resolvedDefault?.environmentId === "local") {
      taskStore.setTaskWorkspace(ROOT_TASK_ID, DEFAULT_WORKSPACE_ID);
      logger.info("Assigned default workspace to system task");
    }

    // Spawn the PowerLine child process with auto-restart on crash
    localPowerLineManager = new LocalPowerLineManager({
      port: powerlinePort,
      host: plBindHost,
      token: localEnv.powerlineToken,
      onStatusChange: (status) => {
        envRegistry.updateEnvironmentStatus("local", status);
        emit("environment.changed", {});
      },
      onRestarted: () => {
        resetReconnectState("local");
      },
    });
    await localPowerLineManager.start();

    // Auto-provision: connect the local adapter
    const localAdapter = getAdapter("local")!;
    const config = parseAdapterConfig(localEnv.adapterConfig);

    envRegistry.updateEnvironmentStatus("local", "connecting");
    emit("environment.changed", {});

    for await (const event of reconnectOrProvision(
      "local",
      localAdapter,
      config,
      localEnv.powerlineToken,
      !!localEnv.bootstrapped,
    )) {
      logger.info({ stage: event.stage, progress: event.progress }, "Local env: %s", event.message);
    }

    const conn = await localAdapter.connect("local", config, localEnv.powerlineToken);
    setConnection("local", conn);
    // Push env-var tokens only — file tokens would just overwrite local credential
    // files (e.g. ~/.claude/credentials.json) with their own content.
    await pushToEnv("local", { excludeFileTokens: true });
    envRegistry.updateEnvironmentStatus("local", "connected");
    envRegistry.markBootstrapped("local");
    emit("environment.changed", {});

    logger.info({ port: powerlinePort }, "Local environment auto-connected");
  } catch (err) {
    // Clean up the PowerLine child if it started but provisioning/connection failed
    const failedManager: LocalPowerLineManager | undefined = localPowerLineManager;
    localPowerLineManager = undefined;
    if (failedManager) {
      await failedManager.stop();
    }
    envRegistry.updateEnvironmentStatus("local", "error");
    emit("environment.changed", {});

    logger.error(
      { err, port: powerlinePort },
      "Failed to start local PowerLine — local environment will not be available. Is port %d in use?",
      powerlinePort,
    );
    // Non-fatal: server continues without local env (remote envs still work)
  }

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

  // --- Reconciliation Manager ---
  const cronPhase = createCronPhase({
    getDueSchedules: scheduleStore.getDueSchedules,
    advanceSchedule: scheduleStore.advanceSchedule,
    createTask: taskStore.createTask,
    setTaskScheduleId: taskStore.setTaskScheduleId,
    startTaskSession,
    emit,
    findFirstConnectedEnvironment,
    getPersona: personaStore.getPersona,
    getTask: taskStore.getTask,
    setScheduleEnabled: scheduleStore.setScheduleEnabled,
    isEnvironmentConnected: (id: string) => {
      const env = envRegistry.getEnvironment(id);
      return env?.status === "connected";
    },
  });
  const orphanPhase = createOrphanPhase({
    listAllTasks: () => {
      const workspaces = workspaceStore.listWorkspaces();
      const allTasks: Array<ReturnType<typeof taskStore.getTask> & {}> = [];
      for (const ws of workspaces) {
        allTasks.push(...taskStore.listTasks(ws.id));
      }
      return allTasks;
    },
    reparentTask: (taskId, newParentTaskId) => taskStore.reparentTask(taskId, newParentTaskId),
    emit,
  });
  const reconciliationManager = new ReconciliationManager([cronPhase, lifecycleCleanupPhase, orphanPhase]);
  reconciliationManager.start();

  // --- gRPC server (HTTP/2) ---
  const grpcPort = parseInt(process.env.GRACKLE_PORT || String(DEFAULT_SERVER_PORT), 10);
  const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";
  const allowNetwork = isWildcardAddress(bindHost);

  /** Format bindHost for embedding in a URL — IPv6 literals need brackets per RFC 2732. */
  const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;
  const grpcHandler = connectNodeAdapter({
    routes: registerGrackleRoutes,
    interceptors: [
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
  const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const webServer = createWebServer({
    apiKey,
    webPort,
    bindHost,
    connectRoutes: registerGrackleRoutes,
  });

  // Wire SIGCHLD: notify parent tasks when child sessions reach terminal status
  initSigchldSubscriber();

  // Wire orphan reparenting: reparent non-terminal children when parent task completes/fails
  initOrphanReparentSubscriber();

  // Wire lifecycle manager: auto-hibernate sessions when all fds are closed
  initLifecycleManager();

  // Auto-start the root task (process 1) when any environment connects.
  // Skipped in E2E tests where the root task session would conflict with test sessions.
  if (process.env.GRACKLE_SKIP_ROOT_AUTOSTART !== "1") {
    let starting = false;
    const tryBootRootTask = async (): Promise<void> => {
      if (starting) {
        return;
      }
      starting = true;
      try {
        const rootTask = taskStore.getTask(ROOT_TASK_ID);
        if (!rootTask) {
          return;
        }

        const taskSessions = sessionStore.listSessionsForTask(ROOT_TASK_ID);
        const { status } = computeTaskStatus(rootTask.status, taskSessions);
        if (status === TASK_STATUS.WORKING) {
          return; // Already running
        }

        // Find any connected environment (prefer local)
        const connectedEnv = findFirstConnectedEnvironment();
        if (!connectedEnv) {
          return;
        }

        const err = await startTaskSession(rootTask, {
          environmentId: connectedEnv.id,
          notes: ROOT_TASK_INITIAL_PROMPT,
        });
        if (err) {
          logger.warn({ err }, "Root task auto-start failed");
        } else {
          logger.info({ environmentId: connectedEnv.id }, "Root task auto-started");
        }
      } catch (bootErr) {
        logger.warn({ err: bootErr }, "Root task auto-start failed");
      } finally {
        starting = false; // eslint-disable-line require-atomic-updates -- single-threaded, flag guards re-entry
      }
    };
    subscribe((event) => {
      if (event.type === "environment.changed") {
        tryBootRootTask().catch(() => { /* logged inside */ });
      }
    });
  }

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

  // --- Knowledge graph subsystem (opt-in) ---
  let knowledgeCleanup: (() => Promise<void>) | undefined;
  if (isKnowledgeEnabled()) {
    try {
      knowledgeCleanup = await initKnowledge();
    } catch (err) {
      logger.error({ err }, "Failed to initialize knowledge graph — continuing without it");
    }
  }

  // --- MCP server (HTTP/1.1, Streamable HTTP) ---
  // Use dialable host for OAuth URLs (wildcard → 127.0.0.1)
  const dialableHost = isWildcardAddress(bindHost) ? "127.0.0.1" : bindHost;
  const dialableUrlHost = dialableHost.includes(":") ? `[${dialableHost}]` : dialableHost;
  const authServerUrl = `http://${dialableUrlHost}:${webPort}`;
  const mcpServer = createMcpServer({ bindHost, mcpPort, grpcPort, apiKey, authorizationServerUrl: authServerUrl });

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

  // Graceful shutdown with a hard timeout so upgraded WS connections don't block exit.
  const SHUTDOWN_TIMEOUT_MS: number = 5_000;

  async function shutdown(): Promise<void> {
    logger.info("Shutting down...");
    stopPairingCleanup();
    stopSessionCleanup();
    stopOAuthCleanup();
    await reconciliationManager.stop();
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Stop the local PowerLine child process first
    const plManager: LocalPowerLineManager | undefined = localPowerLineManager;
    localPowerLineManager = undefined;
    if (plManager) {
      await plManager.stop();
    }

    if (knowledgeCleanup) {
      try {
        await knowledgeCleanup();
      } catch (err) {
        logger.error({ err }, "Error while shutting down knowledge graph");
      }
    }

    await closeAllTunnels();

    await new Promise<void>((resolve) => {
      grpcServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing gRPC server");
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      webServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing web server");
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      mcpServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing MCP server");
        }
        resolve();
      });
    });

    clearTimeout(forceExit);
    process.exit(process.exitCode || 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGINT", shutdown);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
