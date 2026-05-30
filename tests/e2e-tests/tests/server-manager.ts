/**
 * Manages the lifecycle of an isolated Grackle server stack for E2E tests.
 *
 * Each call to {@link startGrackleStack} spawns a fully independent stack
 * (PowerLine + Server on 5 unique ports, with its own GRACKLE_HOME and SQLite DB).
 * Multiple stacks can run in parallel for Playwright worker-level parallelism.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestClient, type GrackleClient } from "./rpc-client.js";
import { COVERAGE_ENABLED } from "../coverage-helpers.js";
import { BACKEND_V8_DIR } from "../coverage-options-backend.js";

const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 15_000;
const MAX_PORT_RETRIES = 10;
/**
 * Max time to wait for a child to exit after SIGTERM before forcing SIGKILL.
 * Set above the server's own graceful-shutdown timeout so backend coverage
 * (which Node flushes only on clean exit) is written before we give up.
 */
const PROCESS_EXIT_TIMEOUT_MS = 10_000;

/**
 * Extra env that instruments the spawned Node processes with V8 coverage when
 * `E2E_COVERAGE=true`. Both the server and PowerLine write raw dumps (with
 * embedded source maps) into the shared {@link BACKEND_V8_DIR}; Node assigns
 * each process a unique filename, so a shared dir is safe. Empty when disabled.
 */
const backendCoverageEnv: NodeJS.ProcessEnv = COVERAGE_ENABLED
  ? { NODE_V8_COVERAGE: BACKEND_V8_DIR }
  : {};

/** State produced by {@link startGrackleStack}, consumed by fixtures and {@link stopGrackleStack}. */
export interface E2EState {
  grackleHome: string;
  apiKey: string;
  pairingCookie: string;
  /** Child process handles, used to await clean exit (and flush V8 coverage) at teardown. */
  powerlineProc: ChildProcess;
  serverProc: ChildProcess;
  powerlinePid: number;
  serverPid: number;
  powerlinePort: number;
  serverPort: number;
  webPort: number;
  mcpPort: number;
  sandboxPort: number;
}

/** Bind a TCP server to port 0 on 127.0.0.1, read the assigned port, close, and return it. */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr !== null) {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Failed to get assigned port")));
      }
    });
    srv.on("error", reject);
  });
}

/** Find N distinct available ports, retrying if the OS returns duplicates. */
async function findDistinctPorts(count: number): Promise<number[]> {
  const ports = new Set<number>();
  let retries = 0;
  while (ports.size < count) {
    if (retries++ > MAX_PORT_RETRIES) {
      throw new Error(`Failed to find ${count} distinct ports after ${MAX_PORT_RETRIES} retries`);
    }
    const port = await findAvailablePort();
    ports.add(port);
  }
  return [...ports];
}

/** Wait until a TCP port accepts connections on 127.0.0.1. */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const { createConnection } = await import("node:net");
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for port ${port}`));
        return;
      }
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(attempt, POLL_INTERVAL_MS);
      });
    }
    attempt();
  });
}

/** Generate a pairing code via gRPC and redeem it via HTTP to obtain a session cookie. */
async function obtainSessionCookie(client: GrackleClient, webPort: number): Promise<string> {
  const { code } = await client.core.generatePairingCode({});

  // Redeem the code via HTTP to get a session cookie
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: webPort,
        path: `/pair?code=${code}`,
        method: "GET",
      },
      (res) => {
        const setCookie = res.headers["set-cookie"];
        if (!setCookie || setCookie.length === 0) {
          reject(new Error("No Set-Cookie header in pairing response"));
          return;
        }
        // Extract just the cookie name=value part (before the first ;)
        const cookieValue = setCookie[0].split(";")[0];
        resolve(cookieValue);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Seed the test environment, personas, and settings via gRPC. */
async function seedTestData(
  client: GrackleClient,
  powerlinePort: number,
  tag: string,
): Promise<void> {
  // Add local PowerLine environment
  await client.core.addEnvironment({
    displayName: "test-local",
    adapterType: "local",
    adapterConfig: JSON.stringify({ port: powerlinePort }),
  });
  console.log(`${tag} Environment added`);

  // Create stub personas and configure defaults.
  // Model is required because resolvePersona() validates non-empty model;
  // the stub runtime ignores it.
  await client.orchestration.createPersona({
    name: "Stub",
    systemPrompt: "E2E test persona",
    runtime: "stub",
    model: "sonnet",
  });
  await client.core.setSetting({ key: "default_persona_id", value: "stub" });
  await client.orchestration.createPersona({
    name: "Stub MCP",
    systemPrompt: "E2E MCP test persona",
    runtime: "stub-mcp",
    model: "sonnet",
  });
  await client.core.setSetting({ key: "onboarding_completed", value: "true" });
  console.log(
    `${tag} Stub and Stub MCP personas created; Stub set as default; onboarding completed`,
  );

  // Provision the environment (server-streaming RPC — drain and check for errors)
  const provisionAbort = AbortSignal.timeout(POLL_TIMEOUT_MS);
  for await (const event of client.core.provisionEnvironment(
    { id: "test-local" },
    { signal: provisionAbort },
  )) {
    if (event.stage === "error") {
      throw new Error(`Provisioning failed: ${event.message}`);
    }
  }
  console.log(`${tag} Environment provisioned`);
}

/** Options for starting a Grackle stack. */
export interface GrackleStackOptions {
  /** Enable the knowledge graph subsystem (requires Neo4j). Default: false. */
  knowledgeEnabled?: boolean;
}

/**
 * Start a fully isolated Grackle stack: PowerLine + Server on 5 unique ports
 * with a dedicated GRACKLE_HOME and SQLite database.
 */
export async function startGrackleStack(options: GrackleStackOptions = {}): Promise<E2EState> {
  const tag = `[e2e:${process.pid}]`;

  // 1. Create isolated temp directory
  const grackleHome = mkdtempSync(join(tmpdir(), "grackle-e2e-"));
  console.log(`${tag} GRACKLE_HOME=${grackleHome}`);

  const repoRoot = join(import.meta.dirname, "../../..");

  // 2. Find available ports (guaranteed distinct). The sandbox port must also be
  // unique per worker — it defaults to 7436, which would collide across the
  // parallel E2E stacks (the sandbox server is fatal on EADDRINUSE).
  const [powerlinePort, serverPort, webPort, mcpPort, sandboxPort] = await findDistinctPorts(5);
  console.log(
    `${tag} Ports: powerline=${powerlinePort}, server=${serverPort}, web=${webPort}, mcp=${mcpPort}, sandbox=${sandboxPort}`,
  );

  // 3. Start PowerLine (no auth needed for E2E tests — local loopback only)
  const powerline: ChildProcess = spawn(
    process.execPath,
    [
      join(repoRoot, "packages/powerline/dist/index.js"),
      "--port",
      String(powerlinePort),
      "--no-auth",
    ],
    {
      env: { ...process.env, GRACKLE_HOME: grackleHome, ...backendCoverageEnv },
      stdio: "pipe",
    },
  );

  powerline.stderr?.on("data", (d: Buffer) => process.stderr.write(`${tag} [powerline] ${d}`));
  powerline.stdout?.on("data", (d: Buffer) => process.stdout.write(`${tag} [powerline] ${d}`));

  // 4. Start server
  const server: ChildProcess = spawn(
    process.execPath,
    [join(repoRoot, "packages/server/dist/index.js")],
    {
      env: {
        ...process.env,
        GRACKLE_HOME: grackleHome,
        GRACKLE_PORT: String(serverPort),
        GRACKLE_WEB_PORT: String(webPort),
        GRACKLE_MCP_PORT: String(mcpPort),
        GRACKLE_SANDBOX_PORT: String(sandboxPort),
        GRACKLE_WEB_DIR: join(repoRoot, "packages/web/dist"),
        GRACKLE_SKIP_LOCAL_POWERLINE: "1",
        GRACKLE_SKIP_ROOT_AUTOSTART: "1",
        // Fast reconciliation tick so reconciliation-driven outcomes (dispatch,
        // KG session/transcript projection) settle quickly in tests.
        GRACKLE_RECONCILIATION_TICK_MS: "2000",
        // Only enable knowledge for the knowledge project to avoid Neo4j
        // contention and reference-node sync overhead in other tests.
        GRACKLE_KNOWLEDGE_ENABLED: options.knowledgeEnabled ? "true" : "",
        ...backendCoverageEnv,
      },
      stdio: "pipe",
    },
  );

  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`${tag} [server] ${d}`));
  server.stdout?.on("data", (d: Buffer) => process.stdout.write(`${tag} [server] ${d}`));

  // 5. Wait for all ports
  console.log(`${tag} Waiting for PowerLine on :${powerlinePort}...`);
  await waitForPort(powerlinePort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for gRPC on :${serverPort}...`);
  await waitForPort(serverPort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for web on :${webPort}...`);
  await waitForPort(webPort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for MCP on :${mcpPort}...`);
  await waitForPort(mcpPort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for sandbox on :${sandboxPort}...`);
  await waitForPort(sandboxPort, POLL_TIMEOUT_MS);
  console.log(`${tag} All servers ready`);

  // 6. Read the auto-generated API key (may not exist immediately after port opens)
  const apiKeyPath = join(grackleHome, ".grackle", "api-key");
  const keyDeadline = Date.now() + POLL_TIMEOUT_MS;
  while (!existsSync(apiKeyPath)) {
    if (Date.now() > keyDeadline) {
      throw new Error(`Timeout waiting for API key file: ${apiKeyPath}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  const apiKey = readFileSync(apiKeyPath, "utf8").trim();
  console.log(`${tag} API key loaded (${apiKey.length} chars)`);

  // 7. Seed test data via gRPC (environment, personas, settings, provision)
  const client = createTestClient(serverPort, apiKey);
  await seedTestData(client, powerlinePort, tag);

  // 8. Obtain a session cookie by generating and redeeming a pairing code
  const pairingCookie = await obtainSessionCookie(client, webPort);
  console.log(`${tag} Session cookie obtained`);

  console.log(`${tag} Setup complete`);
  return {
    grackleHome,
    apiKey,
    pairingCookie,
    powerlineProc: powerline,
    serverProc: server,
    powerlinePid: powerline.pid!,
    serverPid: server.pid!,
    powerlinePort,
    serverPort,
    webPort,
    mcpPort,
    sandboxPort,
  };
}

/**
 * Send SIGTERM and await the process's clean exit, forcing SIGKILL after
 * {@link PROCESS_EXIT_TIMEOUT_MS}. Awaiting the actual exit (rather than a fixed
 * delay) lets the graceful-shutdown handler run to completion — which is what
 * flushes the process's `NODE_V8_COVERAGE` dump when backend coverage is on.
 * (On Windows there are no real signals, so SIGTERM terminates immediately and
 * no dump is written; that's expected — backend coverage is Linux/CI only.)
 */
async function terminateProcess(proc: ChildProcess, label: string, tag: string): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, PROCESS_EXIT_TIMEOUT_MS);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      console.log(`${tag} ${label} exited`);
      resolve();
    });
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already dead — nothing to await.
      clearTimeout(killTimer);
      resolve();
    }
  });
}

/** Tear down a Grackle stack: kill processes (awaiting clean exit) and remove the temp directory. */
export async function stopGrackleStack(state: E2EState): Promise<void> {
  const tag = `[e2e:${process.pid}]`;

  // Send SIGTERM and await clean exit so graceful shutdown completes (and, when
  // enabled, the backend V8 coverage dump is flushed) before we continue.
  await Promise.all([
    terminateProcess(state.serverProc, "server", tag),
    terminateProcess(state.powerlineProc, "powerline", tag),
  ]);

  // Remove temp directory (skip if DEBUG_KEEP_TEMP=1 for failure inspection)
  if (process.env.DEBUG_KEEP_TEMP === "1") {
    console.log(`${tag} Kept temp dir for inspection: ${state.grackleHome}`);
  } else {
    try {
      rmSync(state.grackleHome, { recursive: true, force: true });
      console.log(`${tag} Removed temp dir: ${state.grackleHome}`);
    } catch {
      console.warn(`${tag} Could not remove temp dir: ${state.grackleHome}`);
    }
  }

  console.log(`${tag} Teardown complete`);
}
