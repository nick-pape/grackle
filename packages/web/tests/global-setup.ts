import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FullConfig } from "@playwright/test";

const STATE_FILE = join(tmpdir(), "grackle-e2e-state.json");
const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 15_000;

interface E2EState {
  grackleHome: string;
  apiKey: string;
  powerlinePid: number;
  serverPid: number;
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

  // 2. Start PowerLine (no --token = no auth)
  const powerline: ChildProcess = spawn(
    process.execPath,
    [join(repoRoot, "packages/powerline/dist/index.js"), "--port", "7433"],
    {
      env: { ...process.env, GRACKLE_HOME: grackleHome },
      stdio: "pipe",
    },
  );

  powerline.stderr?.on("data", (d: Buffer) => process.stderr.write(`[powerline] ${d}`));
  powerline.stdout?.on("data", (d: Buffer) => process.stdout.write(`[powerline] ${d}`));

  // 3. Start server
  const server: ChildProcess = spawn(
    process.execPath,
    [join(repoRoot, "packages/server/dist/index.js")],
    {
      env: {
        ...process.env,
        GRACKLE_HOME: grackleHome,
        GRACKLE_PORT: "7434",
        GRACKLE_WEB_PORT: "3000",
        GRACKLE_WEB_DIR: join(repoRoot, "packages/web/dist"),
      },
      stdio: "pipe",
    },
  );

  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));
  server.stdout?.on("data", (d: Buffer) => process.stdout.write(`[server] ${d}`));

  // 4. Wait for both ports
  console.log("[e2e] Waiting for PowerLine on :7433...");
  await waitForPort(7433, POLL_TIMEOUT_MS);
  console.log("[e2e] Waiting for server on :3000...");
  await waitForPort(3000, POLL_TIMEOUT_MS);
  console.log("[e2e] Both servers ready");

  // 5. Read the auto-generated API key
  const apiKey = readFileSync(join(grackleHome, ".grackle", "api-key"), "utf8").trim();
  console.log(`[e2e] API key loaded (${apiKey.length} chars)`);

  // 6. Seed an environment via CLI
  const cliPath = join(repoRoot, "packages/cli/dist/index.js");
  const cliEnv = {
    ...process.env,
    GRACKLE_HOME: grackleHome,
    GRACKLE_URL: "http://localhost:7434",
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

  // 7. Save state for tests and teardown
  const state: E2EState = {
    grackleHome,
    apiKey,
    powerlinePid: powerline.pid!,
    serverPid: server.pid!,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  console.log("[e2e] Setup complete");
}
