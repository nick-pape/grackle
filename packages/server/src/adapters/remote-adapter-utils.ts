import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import type { PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { createPowerLineClient } from "./powerline-transport.js";
import { findFreePort } from "../utils/ports.js";
import { sleep } from "../utils/sleep.js";
import { logger } from "../logger.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

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
/** Remote directory where PowerLine artifacts are installed. Uses $HOME (not ~) so it expands inside double-quoted shell strings. */
const REMOTE_POWERLINE_DIRECTORY: string = "$HOME/.grackle/powerline";

// ─── Dev vs Production Mode ─────────────────────────────────

/**
 * Check if we are running from a monorepo source checkout.
 * We detect this by checking for `rush.json` at the repo root,
 * computed relative to this file's compiled location (packages/server/dist/adapters → 4 levels up).
 * The old approach (checking for a sibling powerline dist) would false-positive when
 * `@grackle-ai/powerline` is installed alongside the server in node_modules.
 */
export function isDevMode(): boolean {
  const repoRoot = resolve(import.meta.dirname, "../../../../");
  return existsSync(join(repoRoot, "rush.json"));
}

/**
 * Read the lockstep version from the server's own package.json.
 * import.meta.dirname = dist/adapters, so ../../package.json = server's package.json.
 */
function getPackageVersion(): string {
  const packageJsonPath = resolve(import.meta.dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  return pkg.version;
}

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
}

const tunnelMap: Map<string, TunnelState> = new Map<string, TunnelState>();

/** Register an active tunnel for an environment, closing any existing tunnel first. */
export function registerTunnel(environmentId: string, state: TunnelState): void {
  const existing = tunnelMap.get(environmentId);
  if (existing) {
    existing.tunnel.close().catch((err) => {
      logger.warn({ err, environmentId }, "Failed to close existing tunnel before registering new one");
    });
  }
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
    try {
      await closeTunnel(id);
    } catch (err) {
      logger.error({ environmentId: id, err }, "Failed to close tunnel during shutdown");
    }
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
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });

    this.process.on("error", (err) => {
      logger.error({ err }, "Tunnel process error");
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ stderr: data.toString() }, "Tunnel stderr");
    });

    // Wait for the local port to become reachable. Kill the process if it fails.
    try {
      await waitForLocalPort(this.localPort);
    } catch (err) {
      await this.close();
      throw err;
    }
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

/** Regex for valid POSIX environment variable names. */
const ENV_VAR_NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
 * Escape a value for safe use inside a shell single-quoted string.
 * Replaces each `'` with `'\''` (end quote, escaped quote, start quote).
 */
function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * Build the list of env-file lines for the PowerLine process.
 * Pure helper used by both {@link writeRemoteEnvFile} and {@link startRemotePowerLine}.
 */
function writeRemoteEnvFileLines(
  powerlineToken: string,
  extraEnv?: Record<string, string>,
): string[] {
  const envLines: string[] = [];
  if (powerlineToken) {
    envLines.push(`export GRACKLE_POWERLINE_TOKEN='${shellEscape(powerlineToken)}'`);
  }
  for (const varName of FORWARDED_ENV_VARS) {
    const value = process.env[varName];
    if (value) {
      envLines.push(`export ${varName}='${shellEscape(value)}'`);
    }
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (!ENV_VAR_NAME_PATTERN.test(key)) {
        logger.warn({ key }, "Skipping invalid env var name");
        continue;
      }
      envLines.push(`export ${key}='${shellEscape(value)}'`);
    }
  }
  return envLines;
}

/**
 * Write the environment variable file to the remote PowerLine directory.
 * Used during both initial bootstrap and reconnect (tokens may have rotated).
 */
export async function writeRemoteEnvFile(
  executor: RemoteExecutor,
  powerlineToken: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  const envLines = writeRemoteEnvFileLines(powerlineToken, extraEnv);
  if (envLines.length === 0) {
    return;
  }
  const envFileContent = envLines.join("\n") + "\n";
  const envFileContentBase64 = Buffer.from(envFileContent, "utf8").toString("base64");
  await executor.exec(
    `cd ${REMOTE_POWERLINE_DIRECTORY} && node -e "require('fs').writeFileSync('.env.sh',Buffer.from(process.argv[1],'base64').toString('utf8'))" '${shellEscape(envFileContentBase64)}'`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
  await executor.exec(
    `chmod 600 ${REMOTE_POWERLINE_DIRECTORY}/.env.sh`,
    { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
  );
}

/** Node.js one-liner that probes the PowerLine port and exits 0/1. */
const PROBE_SCRIPT: string =
  `node -e "const s=require('net').createConnection(${DEFAULT_POWERLINE_PORT},'127.0.0.1');`
  + `s.on('connect',()=>{s.destroy();process.exit(0)});`
  + `s.on('error',()=>process.exit(1))"`;

/**
 * Probe whether the remote PowerLine is listening on its port.
 * Throws if the port is not reachable.
 */
export async function probeRemotePowerLine(executor: RemoteExecutor): Promise<void> {
  await executor.exec(PROBE_SCRIPT, { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
}

/** Options for {@link startRemotePowerLine}. */
interface StartRemotePowerLineOptions {
  /** Additional environment variables forwarded to the remote PowerLine. */
  extraEnv?: Record<string, string>;
  /** Explicit working directory for the PowerLine process. */
  workingDirectory?: string;
  /**
   * When true, detects `/workspaces/*\/` on the remote host (codespace
   * convention) and uses it as the working directory.
   */
  autoDetectWorkspace?: boolean;
  /**
   * When true, the compound script starts with a TCP probe and exits
   * immediately if PowerLine is already listening. This avoids a separate
   * SSH round trip for the initial health check.
   */
  probeFirst?: boolean;
}

/**
 * Node.js one-liner that spawns a fully detached child process.
 *
 * Uses `child_process.spawn()` with `detached: true` and `unref()` so the
 * parent Node process exits immediately. This is the only reliable way to
 * background a process through `gh codespace ssh` — the relay waits for EOF
 * on all inherited FDs, and even `nohup ... < /dev/null > log 2>&1 &` leaves
 * the SSH session hanging because the bash subshell created by `&` holds
 * references to the SSH transport's pipes.
 *
 * Takes three positional arguments (passed by bash, allowing `$HOME` / `$WD`
 * expansion): argv[1] = entryPoint, argv[2] = pidFilePath, argv[3] = logFile.
 * Uses `process.cwd()` as the working directory (caller must `cd` first).
 */
const SPAWN_SCRIPT: string =
  `node -e "`
  + `const fs=require('fs');`
  + `const {spawn}=require('child_process');`
  + `const out=fs.openSync(process.argv[3],'w');`
  + `const c=spawn('node',[process.argv[1],'--port=${DEFAULT_POWERLINE_PORT}'],`
  + `{cwd:process.cwd(),detached:true,stdio:['ignore',out,out]});`
  + `fs.writeFileSync(process.argv[2],String(c.pid));`
  + `c.unref();"`;

/**
 * Ensure the remote PowerLine process is running.
 *
 * Batches env-var write, process start, and port probe into a **single SSH
 * call** to minimize per-call latency (each `gh codespace ssh` round trip
 * takes ~10-15 s through GitHub's relay).
 *
 * Uses Node's `spawn({ detached: true })` to properly daemonize the
 * PowerLine process, avoiding the SSH-hanging issue where `nohup ... &`
 * keeps the session alive through GitHub's codespace relay.
 *
 * When `probeFirst` is true the script begins with a TCP port check and
 * returns immediately if PowerLine is already listening, combining the
 * "is it alive?" check and the "start if not" logic into one SSH call.
 *
 * This is the "restart" middle path — it assumes code is already installed
 * and skips npm install, git checks, and artifact copies.
 */
export async function startRemotePowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  options: StartRemotePowerLineOptions = {},
): Promise<{ alreadyRunning: boolean }> {
  const { extraEnv, workingDirectory, autoDetectWorkspace, probeFirst } = options;

  // Validate workingDirectory to prevent shell injection — must be an absolute POSIX path
  if (workingDirectory && !/^\/[\w./-]+$/.test(workingDirectory)) {
    throw new Error(`Invalid working directory: ${workingDirectory}`);
  }

  const envLines = writeRemoteEnvFileLines(powerlineToken, extraEnv);

  const devMode = isDevMode();
  const entryPoint = devMode
    ? "dist/index.js"
    : "node_modules/@grackle-ai/powerline/dist/index.js";
  const absoluteEntryPoint = `${REMOTE_POWERLINE_DIRECTORY}/${entryPoint}`;
  const logFilePath = "$HOME/.grackle/powerline.log";
  const pidFilePath = `${REMOTE_POWERLINE_DIRECTORY}/powerline.pid`;

  // Build a compound script that runs in a single SSH call:
  //   0. (Optional) Probe — exit early if already listening
  //   1. Write env file (base64 → file)
  //   2. Detect working directory (optional)
  //   3. Source env + spawn PowerLine (detached, exits immediately)
  //   4. Brief sleep + probe
  const parts: string[] = [];

  // 0. Early-exit probe (saves work when PowerLine is already running).
  //    Uses `; ` (not `&&`) to separate from the start logic so that a
  //    failed probe doesn't short-circuit the rest of the script.
  //    `exit 0` exits the top-level bash -c, not a subshell.
  let probeFirstPrefix = "";
  if (probeFirst) {
    probeFirstPrefix = `${PROBE_SCRIPT} && echo "__PL_ALIVE__" && exit 0; `;
  }

  // 1. Env file
  if (envLines.length > 0) {
    const envFileContent = envLines.join("\n") + "\n";
    const envFileContentBase64 = Buffer.from(envFileContent, "utf8").toString("base64");
    parts.push(
      `cd ${REMOTE_POWERLINE_DIRECTORY}`
      + ` && node -e "require('fs').writeFileSync('.env.sh',Buffer.from(process.argv[1],'base64').toString('utf8'))"`
      + ` '${shellEscape(envFileContentBase64)}'`
      + ` && chmod 600 .env.sh`,
    );
  }

  // 2. Working directory
  let startDirExpr: string;
  if (workingDirectory) {
    startDirExpr = workingDirectory;
  } else if (autoDetectWorkspace) {
    // Detect /workspaces/*/ inline; fall back to PowerLine directory.
    // Use ${WD:-default} so the exit code is always 0 ([ -z ] && ... would
    // return 1 when WD is set, breaking the && chain).
    parts.push(
      `WD=$(ls -d /workspaces/*/ 2>/dev/null | head -1 | sed "s/\\/$//");`
      + ` WD=\${WD:-${REMOTE_POWERLINE_DIRECTORY}}`,
    );
    startDirExpr = "$WD";
  } else {
    startDirExpr = REMOTE_POWERLINE_DIRECTORY;
  }

  // 3. Source env vars and spawn PowerLine as a detached process.
  //    Paths are passed as bash arguments (not embedded in the Node script)
  //    so that shell variables like $HOME and $WD are expanded by bash.
  //    The spawn script exits immediately — no SSH hanging.
  const sourceEnv = envLines.length > 0
    ? `. ${REMOTE_POWERLINE_DIRECTORY}/.env.sh && `
    : "";
  parts.push(
    `cd "${startDirExpr}" && ${sourceEnv}`
    + `${SPAWN_SCRIPT} "${absoluteEntryPoint}" "${pidFilePath}" "${logFilePath}"`,
  );

  // 4. Probe (after a brief pause for the port to bind)
  parts.push(`sleep ${POWERLINE_STARTUP_DELAY_MS / 1000} && ${PROBE_SCRIPT}`);

  const compoundScript = probeFirstPrefix + parts.join(" && ");

  try {
    const stdout = await executor.exec(
      `bash -c '${shellEscape(compoundScript)}'`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    if (probeFirst && stdout.includes("__PL_ALIVE__")) {
      logger.info("Remote PowerLine was already running on port %d", DEFAULT_POWERLINE_PORT);
      return { alreadyRunning: true };
    }
    logger.info("Remote PowerLine is listening on port %d", DEFAULT_POWERLINE_PORT);
    return { alreadyRunning: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.info("Failed to start remote PowerLine: %s", detail);
    throw new Error(
      `PowerLine process died immediately after starting. Check ~/.grackle/powerline.log on the remote host. Cause: ${detail}`,
    );
  }
}

/**
 * Bootstrap the PowerLine on a remote host via the given executor.
 * Yields progress events for each stage of the process.
 * @param extraEnv - Additional env vars to forward (from adapter config).
 */
export async function* bootstrapPowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  extraEnv?: Record<string, string>,
  workingDirectory?: string,
): AsyncGenerator<ProvisionEvent> {
  // 1. Check Node.js (PowerLine requires >= 22)
  yield { stage: "bootstrapping", message: "Checking Node.js on remote host...", progress: 0.10 };
  try {
    const nodeVersionOutput = await executor.exec("node --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    const nodeVersion = String(nodeVersionOutput).trim();
    logger.info({ nodeVersion }, "Remote Node.js version");

    const versionMatch = nodeVersion.match(/^v?(\d+)\./);
    if (!versionMatch) {
      throw new Error(
        `Unable to parse Node.js version "${nodeVersion}" on remote host. Install Node.js >= 22 and try again.`,
      );
    }

    const majorVersion = parseInt(versionMatch[1]!, 10);
    if (isNaN(majorVersion) || majorVersion < 22) {
      throw new Error(
        `Unsupported Node.js version "${nodeVersion}" on remote host. PowerLine requires Node.js >= 22.`,
      );
    }
  } catch (error) {
    if (error instanceof Error
      && (error.message.startsWith("Unable to parse Node.js version")
        || error.message.startsWith("Unsupported Node.js version"))) {
      throw error;
    }
    throw new Error(
      "Node.js is not installed or not accessible on the remote host. Install Node.js >= 22 and try again.",
    );
  }

  // 2. Check git
  yield { stage: "bootstrapping", message: "Checking git on remote host...", progress: 0.15 };
  try {
    await executor.exec("git --version", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
  } catch {
    throw new Error("git is not installed on the remote host. Install git and try again.");
  }

  // 3. Install PowerLine — dev mode (copy artifacts) vs production (npm install)
  const devMode = isDevMode();

  if (devMode) {
    // ── Dev mode: copy local monorepo artifacts ──

    yield { stage: "bootstrapping", message: "Creating remote directories...", progress: 0.20 };
    await executor.exec(
      `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/common`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );

    // Resolve local artifact paths relative to server's built location.
    // import.meta.dirname = packages/server/dist/adapters → up 3 levels → packages/
    const serverDistDir = resolve(import.meta.dirname);
    const commonPackageDir = resolve(serverDistDir, "../../../common");
    const powerlinePackageDir = resolve(serverDistDir, "../../../powerline");

    yield { stage: "bootstrapping", message: "Copying PowerLine artifacts...", progress: 0.25 };
    await executor.copyTo(
      join(powerlinePackageDir, "dist"),
      `${REMOTE_POWERLINE_DIRECTORY}/dist`,
    );
    await executor.copyTo(
      join(powerlinePackageDir, "package.json"),
      `${REMOTE_POWERLINE_DIRECTORY}/package.json`,
    );

    // Strip @grackle-ai/* deps (they'll be copied manually) and npm install the rest
    yield { stage: "bootstrapping", message: "Installing dependencies on remote host...", progress: 0.40 };
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && node -e "`
      + `const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));`
      + `for(const k of Object.keys(p.dependencies||{})){if(k.startsWith('@grackle-ai/'))delete p.dependencies[k];}`
      + `for(const k of Object.keys(p.devDependencies||{})){if(k.startsWith('@grackle-ai/'))delete p.devDependencies[k];}`
      + `require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));"`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && npm install --omit=dev`,
      { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
    );

    // Copy @grackle-ai/common into node_modules AFTER npm install (npm would wipe it)
    yield { stage: "bootstrapping", message: "Copying @grackle-ai/common...", progress: 0.55 };
    await executor.exec(
      `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/common`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );
    await executor.copyTo(
      join(commonPackageDir, "dist"),
      `${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/common/dist`,
    );
    await executor.copyTo(
      join(commonPackageDir, "package.json"),
      `${REMOTE_POWERLINE_DIRECTORY}/node_modules/@grackle-ai/common/package.json`,
    );
  } else {
    // ── Production mode: npm install from registry ──
    const version = getPackageVersion();

    yield { stage: "bootstrapping", message: "Creating remote directories...", progress: 0.20 };
    await executor.exec(
      `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}`,
      { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
    );

    yield { stage: "bootstrapping", message: `Installing @grackle-ai/powerline@${version}...`, progress: 0.25 };
    await executor.exec(
      `cd ${REMOTE_POWERLINE_DIRECTORY} && npm init -y && npm install @grackle-ai/powerline@${version} --omit=dev`,
      { timeout: BOOTSTRAP_NPM_INSTALL_TIMEOUT_MS },
    );
  }

  logger.info({ devMode }, "PowerLine bootstrap mode");

  // 7. Copy Claude Code credentials for subscription auth (if present on host).
  //    Stored under the PowerLine directory so destroy() cleans them up.
  const hostCredsPath = join(homedir(), ".claude", ".credentials.json");
  if (existsSync(hostCredsPath)) {
    yield { stage: "pushing_tokens", message: "Copying Claude credentials...", progress: 0.57 };
    try {
      await executor.exec(
        `mkdir -p ${REMOTE_POWERLINE_DIRECTORY}/.claude`,
        { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
      );
      await executor.copyTo(
        hostCredsPath,
        `${REMOTE_POWERLINE_DIRECTORY}/.claude/.credentials.json`,
      );
      await executor.exec(
        `chmod 600 ${REMOTE_POWERLINE_DIRECTORY}/.claude/.credentials.json`,
        { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
      );
      // Symlink so Claude Code finds it at the expected ~/.claude path.
      // Only create if no credentials file already exists (avoid clobbering user's own setup).
      await executor.exec(
        `mkdir -p ~/.claude && if [ ! -e ~/.claude/.credentials.json ]; then ln -s ${REMOTE_POWERLINE_DIRECTORY}/.claude/.credentials.json ~/.claude/.credentials.json; fi`,
        { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS },
      );
    } catch (err) {
      logger.warn({ err }, "Failed to copy Claude credentials (agent may need manual login)");
    }
  }

  // 8. Kill any existing PowerLine process on the port (with fallbacks)
  yield { stage: "bootstrapping", message: "Stopping any existing PowerLine process...", progress: 0.60 };
  try {
    await executor.exec(buildRemoteKillCommand(), { timeout: REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
    await sleep(1_000);
  } catch {
    // Ignore — no process to kill
  }

  // 9–11. Write env vars, start process, wait, verify
  yield { stage: "bootstrapping", message: "Starting PowerLine on remote host...", progress: 0.65 };
  await startRemotePowerLine(executor, powerlineToken, { extraEnv, workingDirectory });

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

  // Clean up the tunnel so we don't leak background processes on connect failure
  try {
    await closeTunnel(environmentId);
  } catch (err) {
    logger.error({ environmentId, err }, "Failed to close tunnel after connect failure");
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

// ─── Remote Process Kill ────────────────────────────────────

/**
 * Build a shell command that kills the remote PowerLine process.
 * Prefers killing by tracked PID (written at startup) to avoid terminating
 * unrelated services on the same port. Falls back to port-based kill.
 */
export function buildRemoteKillCommand(): string {
  const pidfile = `${REMOTE_POWERLINE_DIRECTORY}/powerline.pid`;

  // Try pidfile-based kill first (safe — only kills what we started)
  const pidfileKill = [
    `[ -f "${pidfile}" ]`,
    `PID=$(cat "${pidfile}" 2>/dev/null)`,
    `[ -n "$PID" ]`,
    `kill "$PID" 2>/dev/null`,
    `rm -f "${pidfile}"`,
  ].join(" && ");

  // Fallback: port-based kill (for upgrades from before pidfile support)
  const portKill =
    `fuser -k ${DEFAULT_POWERLINE_PORT}/tcp 2>/dev/null`
    + ` || lsof -ti:${DEFAULT_POWERLINE_PORT} | xargs kill 2>/dev/null`
    + ` || pkill -f "powerline.*${DEFAULT_POWERLINE_PORT}" 2>/dev/null`;

  return `(${pidfileKill}) || (${portKill}) || true`;
}

// ─── Shared Adapter Operations ──────────────────────────────

/**
 * Stop the remote PowerLine process and close the tunnel.
 * Shared by SSH and Codespace adapters.
 */
export async function remoteStop(environmentId: string, executor: RemoteExecutor): Promise<void> {
  try {
    await executor.exec(buildRemoteKillCommand());
  } catch (err) {
    logger.debug({ environmentId, err }, "Failed to kill remote PowerLine (may already be stopped)");
  }
  await closeTunnel(environmentId);
}

/**
 * Stop the remote PowerLine, remove artifacts, and close the tunnel.
 * Shared by SSH and Codespace adapters.
 */
export async function remoteDestroy(environmentId: string, executor: RemoteExecutor): Promise<void> {
  try {
    await executor.exec(
      `${buildRemoteKillCommand()}; `
      + 'CRED="$HOME/.claude/.credentials.json"; '
      + `if [ -L "$CRED" ]; then case "$(readlink "$CRED" 2>/dev/null)" in ${REMOTE_POWERLINE_DIRECTORY}/*) rm -f "$CRED";; esac; fi; `
      + `rm -rf ${REMOTE_POWERLINE_DIRECTORY}`,
    );
  } catch (err) {
    logger.debug({ environmentId, err }, "Failed to clean up remote PowerLine artifacts");
  }
  await closeTunnel(environmentId);
}

/** Check that the tunnel is alive and the PowerLine responds to a ping. */
export async function remoteHealthCheck(connection: PowerLineConnection): Promise<boolean> {
  const state = getTunnel(connection.environmentId);
  if (!state || !state.tunnel.isAlive()) {
    return false;
  }
  try {
    await connection.client.ping({});
    return true;
  } catch {
    return false;
  }
}

// ─── Exports for Adapter Use ────────────────────────────────

export { findFreePort, REMOTE_POWERLINE_DIRECTORY, SSH_CONNECTIVITY_TIMEOUT_MS, REMOTE_EXEC_DEFAULT_TIMEOUT_MS };
