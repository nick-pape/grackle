import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { createRequire } from "node:module";
import { logger as parentLogger } from "./logger.js";

const PORT_PROBE_TIMEOUT_MS: number = 15_000;
const PORT_PROBE_INTERVAL_MS: number = 300;
const STOP_TIMEOUT_MS: number = 2_000;

// eslint-disable-next-line @rushstack/typedef-var
const logger = parentLogger.child({ component: "powerline" });

/** Handle returned by {@link startLocalPowerLine} to manage the child process. */
export interface LocalPowerLineHandle {
  /** Stop the child process gracefully (SIGTERM, then SIGKILL after timeout). */
  stop: () => Promise<void>;
  /** The underlying child process. */
  process: ChildProcess;
}

/** Options for starting the local PowerLine child process. */
export interface StartLocalPowerLineOptions {
  /** Port the PowerLine should listen on. */
  port: number;
  /** Host the PowerLine should bind to. */
  host: string;
  /** Authentication token the PowerLine should require. */
  token: string;
  /** Callback invoked if the child exits unexpectedly. */
  onExit?: (code: number | undefined, signal: string | undefined) => void;
}

/**
 * Wait for a TCP port to accept connections.
 *
 * @param port - The port to probe.
 * @param host - The host to connect to.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 */
async function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock: net.Socket = net.createConnection({ host, port });
        sock.once("connect", () => {
          sock.destroy();
          resolve();
        });
        sock.once("error", () => {
          sock.destroy();
          reject();
        });
      });
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, PORT_PROBE_INTERVAL_MS));
    }
  }

  throw new Error(`Timeout waiting for PowerLine on ${host}:${port} after ${timeoutMs}ms`);
}

/**
 * Spawn a local PowerLine child process and wait for it to accept connections.
 *
 * The child is NOT detached — it dies with the server process (desired behavior).
 *
 * @param options - Configuration for the PowerLine child process.
 * @returns A handle to manage the child process lifecycle.
 */
export async function startLocalPowerLine(options: StartLocalPowerLineOptions): Promise<LocalPowerLineHandle> {
  const { port, host, token, onExit } = options;

  // Resolve the PowerLine entry point via its package's main field
  const esmRequire: NodeRequire = createRequire(import.meta.url);
  const entryPoint: string = esmRequire.resolve("@grackle-ai/powerline");

  logger.info({ port, host, entryPoint }, "Starting local PowerLine");

  const child: ChildProcess = spawn(
    process.execPath,
    [entryPoint, "--port", String(port), "--token", token, "--host", host],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  // Pipe child stdout/stderr through pino child logger
  child.stdout!.on("data", (chunk: Buffer) => {
    const lines: string[] = chunk.toString("utf8").trim().split("\n");
    for (const line of lines) {
      logger.info(line);
    }
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    const lines: string[] = chunk.toString("utf8").trim().split("\n");
    for (const line of lines) {
      logger.warn(line);
    }
  });

  let exited: boolean = false;

  child.once("exit", (code, signal) => {
    exited = true;
    if (onExit) {
      onExit(code ?? undefined, signal ?? undefined);
    }
  });

  // Wait for the port to accept connections
  try {
    await waitForPort(port, host === "0.0.0.0" ? "127.0.0.1" : host, PORT_PROBE_TIMEOUT_MS);
  } catch (err) {
    // If the child already exited, include that in the error
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exited may flip during async waitForPort
    if (exited) {
      throw new Error(`PowerLine process exited before accepting connections on port ${port}`);
    }
    // Kill the child since it failed to start properly
    child.kill("SIGTERM");
    throw err;
  }

  logger.info({ port, host, pid: child.pid }, "Local PowerLine is ready");

  /** Stop the child process gracefully. */
  async function stop(): Promise<void> {
    if (exited) {
      return;
    }

    logger.info("Stopping local PowerLine");
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const forceKillTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (!exited) {
          logger.warn("PowerLine did not exit after SIGTERM, sending SIGKILL");
          child.kill("SIGKILL");
        }
      }, STOP_TIMEOUT_MS);

      child.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      // If already exited while we were setting up
      if (exited) {
        clearTimeout(forceKillTimer);
        resolve();
      }
    });
  }

  return { stop, process: child };
}
