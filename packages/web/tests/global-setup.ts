import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FullConfig } from "@playwright/test";
import { STATE_FILE } from "./state-file.js";

const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 15_000;

interface E2EState {
  grackleHome: string;
  apiKey: string;
  powerlinePid: number;
  serverPid: number;
  powerlinePort: number;
  serverPort: number;
  webPort: number;
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

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // 1. Create isolated temp directory
  const grackleHome = mkdtempSync(join(tmpdir(), "grackle-e2e-"));
  console.log(`[e2e] GRACKLE_HOME=${grackleHome}`);

  const repoRoot = join(import.meta.dirname, "../../..");

  // 2. Find available ports
  const powerlinePort = await findAvailablePort();
  const serverPort = await findAvailablePort();
  const webPort = await findAvailablePort();
  console.log(`[e2e] Ports: powerline=${powerlinePort}, server=${serverPort}, web=${webPort}`);

  // 3. Start PowerLine (no --token = no auth)
  const powerline: ChildProcess = spawn(
    process.execPath,
    [join(repoRoot, "packages/powerline/dist/index.js"), "--port", String(powerlinePort)],
    {
      env: { ...process.env, GRACKLE_HOME: grackleHome },
      stdio: "pipe",
    },
  );

  powerline.stderr?.on("data", (d: Buffer) => process.stderr.write(`[powerline] ${d}`));
  powerline.stdout?.on("data", (d: Buffer) => process.stdout.write(`[powerline] ${d}`));

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
        GRACKLE_WEB_DIR: join(repoRoot, "packages/web/dist"),
      },
      stdio: "pipe",
    },
  );

  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));
  server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));

  // 5. Wait for both ports
  console.log(`[e2e] Waiting for PowerLine on :${powerlinePort}...`);
  await waitForPort(powerlinePort, POLL_TIMEOUT_MS);
  console.log(`[e2e] Waiting for server on :${webPort}...`);
  await waitForPort(webPort, POLL_TIMEOUT_MS);
  console.log("[e2e] Both servers ready");

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
  console.log(`[e2e] API key loaded (${apiKey.length} chars)`);

  // 7. Seed an environment via CLI
  const cliPath = join(repoRoot, "packages/cli/dist/index.js");
  const cliEnv = {
    ...process.env,
    GRACKLE_HOME: grackleHome,
    GRACKLE_URL: `http://localhost:${serverPort}`,
    GRACKLE_API_KEY: apiKey,
  };

  execSync(`node "${cliPath}" env add test-local --local --runtime stub`, {
    env: cliEnv,
    stdio: "pipe",
  });
  console.log("[e2e] Environment added");

  execSync(`node "${cliPath}" env provision test-local`, {
    env: cliEnv,
    stdio: "pipe",
  });
  console.log("[e2e] Environment provisioned");

  // 8. Save state for tests and teardown
  const state: E2EState = {
    grackleHome,
    apiKey,
    powerlinePid: powerline.pid!,
    serverPid: server.pid!,
    powerlinePort,
    serverPort,
    webPort,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  console.log("[e2e] Setup complete");
}
