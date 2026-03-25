/**
 * Manages the lifecycle of an isolated Grackle server stack for E2E tests.
 *
 * Each call to {@link startGrackleStack} spawns a fully independent stack
 * (PowerLine + Server on 4 unique ports, with its own GRACKLE_HOME and SQLite DB).
 * Multiple stacks can run in parallel for Playwright worker-level parallelism.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 15_000;
const MAX_PORT_RETRIES = 10;
const TEARDOWN_GRACE_MS = 500;

/** State produced by {@link startGrackleStack}, consumed by fixtures and {@link stopGrackleStack}. */
export interface E2EState {
  grackleHome: string;
  apiKey: string;
  pairingCookie: string;
  powerlinePid: number;
  serverPid: number;
  powerlinePort: number;
  serverPort: number;
  webPort: number;
  mcpPort: number;
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

/** Generate a pairing code via the CLI and redeem it via HTTP to obtain a session cookie. */
async function obtainSessionCookie(serverPort: number, webPort: number, apiKey: string, grackleHome: string): Promise<string> {
  const repoRoot = join(import.meta.dirname, "../../..");
  const cliPath = join(repoRoot, "packages/cli/dist/index.js");

  // Generate a pairing code via the CLI
  const cliOutput = execSync(
    `node "${cliPath}" pair`,
    {
      env: {
        ...process.env,
        GRACKLE_HOME: grackleHome,
        GRACKLE_URL: `http://127.0.0.1:${serverPort}`,
        GRACKLE_API_KEY: apiKey,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      encoding: "utf8",
    },
  );

  // Extract the code from CLI output (format: "  Pairing code: XXXXXX")
  const codeMatch = cliOutput.match(/Pairing code:\s*(\S+)/i);
  if (!codeMatch) {
    throw new Error(`Could not extract pairing code from CLI output: ${cliOutput}`);
  }
  const code = codeMatch[1];

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

/**
 * Start a fully isolated Grackle stack: PowerLine + Server on 4 unique ports
 * with a dedicated GRACKLE_HOME and SQLite database.
 */
export async function startGrackleStack(): Promise<E2EState> {
  const tag = `[e2e:${process.pid}]`;

  // 1. Create isolated temp directory
  const grackleHome = mkdtempSync(join(tmpdir(), "grackle-e2e-"));
  console.log(`${tag} GRACKLE_HOME=${grackleHome}`);

  const repoRoot = join(import.meta.dirname, "../../..");

  // 2. Find available ports (guaranteed distinct)
  const [powerlinePort, serverPort, webPort, mcpPort] = await findDistinctPorts(4);
  console.log(`${tag} Ports: powerline=${powerlinePort}, server=${serverPort}, web=${webPort}, mcp=${mcpPort}`);

  // 3. Start PowerLine (no auth needed for E2E tests — local loopback only)
  const powerline: ChildProcess = spawn(
    process.execPath,
    [join(repoRoot, "packages/powerline/dist/index.js"), "--port", String(powerlinePort), "--no-auth"],
    {
      env: { ...process.env, GRACKLE_HOME: grackleHome },
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
        GRACKLE_WEB_DIR: join(repoRoot, "packages/web/dist"),
        GRACKLE_SKIP_LOCAL_POWERLINE: "1",
        GRACKLE_SKIP_ROOT_AUTOSTART: "1",
        // Enable knowledge graph when Neo4j is available (CI service container)
        GRACKLE_KNOWLEDGE_ENABLED: process.env.GRACKLE_KNOWLEDGE_ENABLED ?? "",
      },
      stdio: "pipe",
    },
  );

  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`${tag} [server] ${d}`));
  server.stdout?.on("data", (d: Buffer) => process.stdout.write(`${tag} [server] ${d}`));

  // 5. Wait for all ports
  console.log(`${tag} Waiting for PowerLine on :${powerlinePort}...`);
  await waitForPort(powerlinePort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for server on :${webPort}...`);
  await waitForPort(webPort, POLL_TIMEOUT_MS);
  console.log(`${tag} Waiting for MCP server on :${mcpPort}...`);
  await waitForPort(mcpPort, POLL_TIMEOUT_MS);
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

  // 7. Seed an environment via CLI
  const cliPath = join(repoRoot, "packages/cli/dist/index.js");
  const cliEnv = {
    ...process.env,
    GRACKLE_HOME: grackleHome,
    GRACKLE_URL: `http://localhost:${serverPort}`,
    GRACKLE_API_KEY: apiKey,
  };

  execSync(`node "${cliPath}" env add test-local --local --port ${powerlinePort}`, {
    env: cliEnv,
    stdio: "pipe",
  });
  console.log(`${tag} Environment added`);

  // Create a stub persona and set it as the app default for E2E tests.
  // --model sonnet is required because resolvePersona() validates non-empty model;
  // the stub runtime ignores it.
  execSync(`node "${cliPath}" persona create "Stub" --prompt "E2E test persona" --runtime stub --model sonnet`, {
    env: cliEnv,
    stdio: "pipe",
  });
  execSync(`node "${cliPath}" config set default-persona stub`, {
    env: cliEnv,
    stdio: "pipe",
  });
  execSync(`node "${cliPath}" persona create "Stub MCP" --prompt "E2E MCP test persona" --runtime stub-mcp --model sonnet`, {
    env: cliEnv,
    stdio: "pipe",
  });
  execSync(`node "${cliPath}" config set onboarding_completed true`, {
    env: cliEnv,
    stdio: "pipe",
  });
  console.log(`${tag} Stub and Stub MCP personas created; Stub set as default; onboarding completed`);

  execSync(`node "${cliPath}" env provision test-local`, {
    env: cliEnv,
    stdio: "pipe",
  });
  console.log(`${tag} Environment provisioned`);

  // 8. Obtain a session cookie by generating and redeeming a pairing code
  const pairingCookie = await obtainSessionCookie(serverPort, webPort, apiKey, grackleHome);
  console.log(`${tag} Session cookie obtained`);

  console.log(`${tag} Setup complete`);
  return {
    grackleHome,
    apiKey,
    pairingCookie,
    powerlinePid: powerline.pid!,
    serverPid: server.pid!,
    powerlinePort,
    serverPort,
    webPort,
    mcpPort,
  };
}

/** Tear down a Grackle stack: kill processes and remove the temp directory. */
export async function stopGrackleStack(state: E2EState): Promise<void> {
  const tag = `[e2e:${process.pid}]`;

  // Kill server + PowerLine
  for (const pid of [state.serverPid, state.powerlinePid]) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`${tag} Killed process ${pid}`);
    } catch {
      // Process may already be dead
    }
  }

  // Small delay to let processes exit
  await new Promise((resolve) => setTimeout(resolve, TEARDOWN_GRACE_MS));

  // Remove temp directory
  try {
    rmSync(state.grackleHome, { recursive: true, force: true });
    console.log(`${tag} Removed temp dir: ${state.grackleHome}`);
  } catch {
    console.warn(`${tag} Could not remove temp dir: ${state.grackleHome}`);
  }

  console.log(`${tag} Teardown complete`);
}
