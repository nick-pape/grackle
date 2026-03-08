import { DEFAULT_POWERLINE_PORT } from "@grackle/common";
import type { PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { createPowerLineClient } from "./powerline-transport.js";
import { findFreePort } from "../utils/ports.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../logger.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────

/** Timeout for `npm install` on the remote host. */
const BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS: number = 120_000;
/** Default timeout for remote command execution. */
const REMOTE_EXEC_DEFAULT_TIMEOUT_MS: number = 60_000;
/** Delay between gRPC connect-with-retry attempts. */
const CONNECT_RETRY_DELAY_MS: number = 1_500;
/** Maximum number of gRPC connect-with-retry attempts. */
const CONNECT_MAX_RETRIES: number = 10;
/** Delay between port availability polls. */
const TUNNEL_PORT_POLL_DELAY_MS: number = 500;
/** Maximum number of port availability polls. */
const TUNNEL_PORT_POLL_MAX_ATTEMPTS: number = 20;
/** Wait after starting the remote PowerLine process before verifying. */
const POWERLINE_STARTUP_DELAY_MS: number = 2_000;
/** Grace period before sending SIGKILL to a tunnel process. */
const TUNNEL_KILL_GRACE_MS: number = 1_000;
/** Timeout for the initial SSH connectivity test. */
const SSH_CONNECTIVITY_TIMEOUT_MS: number = 15_000;
/** Remote directory where PowerLine artifacts are installed. */
const REMOTE_POWERLINE_DIRECTORY: string = "~/.grackle/powerline";

// ─── Interfaces ─────────────────────────────────────────────

/** Abstraction for executing commands on a remote host. */
export interface RemoteExecutor {
  /** Execute a shell command on the remote host and return stdout. */
  exec(command: string, opts?: { timeout?: number }): Promise<string>;
  /** Copy a local file or directory to a path on the remote host. */
  copyTo(localPath: string, remotePath: string): Promise<void>;
}

/** Abstraction for a long-lived port-forwarding tunnel. */
export interface RemoteTunnel {
  /** The local port the tunnel is bound to. */
  localPort: number;
  /** Open the tunnel (spawns a background process). */
  open(): Promise<void>;
  /** Close the tunnel (kills the background process). */
  close(): Promise<void>;
  /** Return true if the tunnel process is still running. */
  isAlive(): boolean;
}

// ─── Tunnel Manager ─────────────────────────────────────────

interface TunnelState {
  tunnel: RemoteTunnel;
  remotePowerLinePid?: number;
}

const tunnelMap: Map<string, TunnelState> = new Map<string, TunnelState>();

/** Register an active tunnel for an environment. */
export function registerTunnel(environmentId: string, state: TunnelState): void {
  tunnelMap.set(environmentId, state);
}

/** Get the tunnel state for an environment. */
export function getTunnel(environmentId: string): TunnelState | undefined {
  return tunnelMap.get(environmentId);
}

/** Close and unregister the tunnel for an environment. */
export async function closeTunnel(environmentId: string): Promise<void> {
  const state = tunnelMap.get(environmentId);
  if (state) {
    await state.tunnel.close();
    tunnelMap.delete(environmentId);
  }
}

/** Close all active tunnels (called during server shutdown). */
export async function closeAllTunnels(): Promise<void> {
  const ids = [...tunnelMap.keys()];
  for (const id of ids) {
    await closeTunnel(id);
  }
}

// ─── Tunnel Process Base ────────────────────────────────────

/**
 * Base class for tunnels backed by a long-lived child process.
 * Subclasses provide the command and arguments to spawn.
 */
export abstract class ProcessTunnel implements RemoteTunnel {
  public localPort: number;
  protected process: ChildProcess | undefined;

  public constructor(localPort: number) {
    this.localPort = localPort;
  }

  /** Return the command and arguments to spawn the tunnel process. */
  protected abstract spawnArgs(): { command: string; args: string[] };

  /** Open the tunnel by spawning the background process. */
  public async open(): Promise<void> {
    const { command, args } = this.spawnArgs();
    logger.info({ command, args }, "Opening tunnel");

    this.process = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.process.on("error", (err) => {
      logger.error({ err }, "Tunnel process error");
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ stderr: data.toString() }, "Tunnel stderr");
    });

    // Wait for the local port to become reachable
    await waitForLocalPort(this.localPort);
  }

  /** Close the tunnel by killing the background process. */
  public async close(): Promise<void> {
    if (!this.process || this.process.exitCode !== null) {
      return;
    }
    this.process.kill("SIGTERM");
    await sleep(TUNNEL_KILL_GRACE_MS);
    if (this.process.exitCode === null) {
      this.process.kill("SIGKILL");
    }
    this.process = undefined;
  }

  /** Return true if the tunnel process is still running. */
  public isAlive(): boolean {
    return this.process !== undefined && this.process.exitCode === null;
  }
}

// ─── Bootstrap PowerLine ────────────────────────────────────

/** Environment variables to forward to the remote PowerLine process. */
const FORWARDED_ENV_VARS: string[] = [
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_CLI_URL",
  "COPILOT_CLI_PATH",
  "COPILOT_PROVIDER_CONFIG",
];

/**
 * Bootstrap the PowerLine on a remote host via the given executor.
 * Yields progress events for each stage of the process.
 */
export async function* bootstrapPowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
): AsyncGenerator<ProvisionEvent> {
  // 1. Check Node.js
  yield { stage: "bootstrapping", message: "Checking Node.js on remote host...", progress: 0.10 };
  try {
    const nodeVersion = await executor.exec("node --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    logger.info({ nodeVersion }, "Remote Node.js version");
  } catch {
    throw new Error("Node.js is not installed on the remote host. Install Node.js >= 18 and try again.");
  }

  // 2. Check git
  yield { stage: "bootstrapping", message: "Checking git on remote host...", progress: 0.15 };
  try {
    await executor.exec("git --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
  } catch {
    throw new Error("git is not installed on the remote host. Install git and try again.");
  }

  // 3. Create remote directory structure
  yield { stage: "bootstrapping", message: "Creating remote directories...", progress: 0.20 };
  await executor.exec(
    `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle/common`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );

  // 4. Copy artifacts — powerline dist + package.json first, then npm install,
  //    then copy @grackle/common into node_modules (npm install would wipe it).
  yield { stage: "bootstrapping", message: "Copying PowerLine artifacts to remote host...", progress: 0.25 };

  // Resolve local artifact paths relative to server's built location.
  // import.meta.dirname = packages/server/dist/adapters, so we go up 3 levels
  // to reach packages/, then into common/ or powerline/.
  const serverDistDir = resolve(import.meta.dirname);
  const commonPackageDir = resolve(serverDistDir, "../../../common");
  const powerlinePackageDir = resolve(serverDistDir, "../../../powerline");

  // Copy powerline package (dist + package.json)
  yield { stage: "bootstrapping", message: "Copying @grackle/powerline...", progress: 0.30 };
  await executor.copyTo(
    join(powerlinePackageDir, "dist"),
    `${REMOTE_POWERLINE_DIRECTORY}/dist`,
  );
  await executor.copyTo(
    join(powerlinePackageDir, "package.json"),
    `${REMOTE_POWERLINE_DIRECTORY}/package.json`,
  );

  // 5. Strip @grackle/* deps from package.json (they'll be copied manually)
  //    and run npm install for the remaining public dependencies.
  yield { stage: "bootstrapping", message: "Installing dependencies on remote host...", progress: 0.40 };
  await executor.exec(
    `cd ${REMOTE_POWERLINE_DIRECTORY} && node -e "`
    + `const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));`
    + `for(const k of Object.keys(p.dependencies||{})){if(k.startsWith('@grackle/'))delete p.dependencies[k];}`
    + `for(const k of Object.keys(p.devDependencies||{})){if(k.startsWith('@grackle/'))delete p.devDependencies[k];}`
    + `require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));"`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
  await executor.exec(
    `cd ${REMOTE_POWERLINE_DIRECTORY} && npm install --omit=dev`,
    { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
  );

  // 6. Copy @grackle/common into node_modules AFTER npm install (npm would wipe it)
  yield { stage: "bootstrapping", message: "Copying @grackle/common...", progress: 0.55 };
  await executor.exec(
    `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle/common`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
  await executor.copyTo(
    join(commonPackageDir, "dist"),
    `${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle/common/dist`,
  );
  await executor.copyTo(
    join(commonPackageDir, "package.json"),
    `${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle/common/package.json`,
  );

  // 7. Kill any existing PowerLine process using fuser on the port
  yield { stage: "bootstrapping", message: "Stopping any existing PowerLine process...", progress: 0.60 };
  try {
    await executor.exec(
      `fuser -k ${DEFAULT_POWERLINE_PORT}/tcp 2>/dev/null || true`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    await sleep(1_000);
  } catch {
    // Ignore — no process to kill
  }

  // 8. Build env var string for the remote process
  const envParts: string[] = [];
  if (powerlineToken) {
    envParts.push(`GRACKLE_POWERLINE_TOKEN='${powerlineToken}'`);
  }
  for (const varName of FORWARDED_ENV_VARS) {
    const value = process.env[varName];
    if (value) {
      envParts.push(`${varName}='${value}'`);
    }
  }
  const envPrefix = envParts.length > 0 ? envParts.join(" ") + " " : "";

  // 9. Start PowerLine via bash -c to ensure proper backgrounding.
  //    We avoid capturing $! because some transports (gh codespace ssh) exit
  //    with code 255 when the shell backgrounds a process.
  yield { stage: "bootstrapping", message: "Starting PowerLine on remote host...", progress: 0.65 };
  const innerCommand =
    `cd ${REMOTE_POWERLINE_DIRECTORY}`
    + ` && ${envPrefix}nohup node dist/index.js --port=${DEFAULT_POWERLINE_PORT}`
    + ` > ~/.grackle/powerline.log 2>&1 &`;

  try {
    await executor.exec(`bash -c '${innerCommand}'`, { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
  } catch (err) {
    // Some SSH transports return non-zero when the session ends after backgrounding.
    // We'll verify the process is running below — only log the error.
    logger.debug({ err }, "Start command returned non-zero (expected with background process)");
  }

  // 10. Wait for process to stabilize, then verify via pgrep
  yield { stage: "bootstrapping", message: "Waiting for PowerLine to start...", progress: 0.70 };
  await sleep(POWERLINE_STARTUP_DELAY_MS);

  // Verify the port is listening using a Node.js one-liner (pgrep may not be in PATH)
  try {
    await executor.exec(
      `node -e "const s=require('net').createConnection(${DEFAULT_POWERLINE_PORT},'127.0.0.1');\
s.on('connect',()=>{s.destroy();process.exit(0)});\
s.on('error',()=>process.exit(1))"`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    logger.info("Remote PowerLine is listening on port %d", DEFAULT_POWERLINE_PORT);
  } catch {
    throw new Error(
      "PowerLine process died immediately after starting. Check ~/.grackle/powerline.log on the remote host.",
    );
  }

  yield { stage: "bootstrapping", message: "PowerLine is running on remote host", progress: 0.75 };
}

// ─── Connect Through Tunnel ────────────────────────────────

/**
 * Connect to a PowerLine through a local tunnel port, retrying until the gRPC
 * service responds to a ping.
 */
export async function connectThroughTunnel(
  environmentId: string,
  localPort: number,
  powerlineToken: string,
): Promise<PowerLineConnection> {
  const client = createPowerLineClient(`http://127.0.0.1:${localPort}`, powerlineToken);

  let lastError: unknown;
  for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
    try {
      await client.ping({});
      return { client, environmentId, port: localPort };
    } catch (err) {
      lastError = err;
      await sleep(CONNECT_RETRY_DELAY_MS);
    }
  }

  throw new Error(`Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastError}`);
}

// ─── Wait for Local Port ────────────────────────────────────

/**
 * Poll until a TCP connection can be established on localhost at the given port.
 * Used to wait for a tunnel process to begin accepting connections.
 */
export async function waitForLocalPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < TUNNEL_PORT_POLL_MAX_ATTEMPTS; attempt++) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (reachable) {
      return;
    }
    await sleep(TUNNEL_PORT_POLL_DELAY_MS);
  }

  throw new Error(`Local port ${port} did not become reachable after ${TUNNEL_PORT_POLL_MAX_ATTEMPTS} attempts`);
}

// ─── Exports for Adapter Use ────────────────────────────────

export { findFreePort, REMOTE_POWERLINE_DIRECTORY, SSH_CONNECTIVITY_TIMEOUT_MS, REMOTE_EXEC_DEFAULT_TIMEOUT_MS };
