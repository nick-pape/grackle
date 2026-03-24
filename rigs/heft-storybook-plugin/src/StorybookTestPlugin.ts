import { execFileSync, spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as net from "net";
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "storybook-test-plugin";

/** Maximum time (ms) to wait for the HTTP server to accept connections. */
const SERVER_READY_TIMEOUT_MS: number = 30_000;

/** Find a free ephemeral port by binding to port 0 and reading the assigned port. */
async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv: net.Server = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr: net.AddressInfo = srv.address() as net.AddressInfo;
      const port: number = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Wait until a TCP port accepts connections, or throw after timeout. */
async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock: net.Socket = net.createConnection({ host: "127.0.0.1", port });
        sock.once("connect", () => { sock.destroy(); resolve(); });
        sock.once("error", () => { sock.destroy(); reject(); });
      });
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Timed out waiting for port ${port} after ${timeoutMs}ms`);
}

/**
 * Heft task plugin that serves the static Storybook build and runs
 * `test-storybook` against it to execute interaction tests (play functions).
 */
class StorybookTestPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      const buildFolder: string = heftConfiguration.buildFolderPath;
      const staticDir: string = path.join(buildFolder, "storybook-static");
      const isWindows: boolean = process.platform === "win32";
      const httpServerBin: string = path.join(buildFolder, "node_modules", ".bin", isWindows ? "http-server.cmd" : "http-server");
      const testStorybookBin: string = path.join(buildFolder, "node_modules", ".bin", isWindows ? "test-storybook.cmd" : "test-storybook");

      const suppressWarningsEnv: NodeJS.ProcessEnv = {
        ...process.env,
        STORYBOOK_DISABLE_TELEMETRY: "1",
        CI: "true",
        NODE_NO_WARNINGS: "1",
      };

      const port: number = await findFreePort();
      session.logger.terminal.writeLine(`Starting Storybook static server on port ${port}...`);

      const server: ChildProcess = spawn(
        httpServerBin,
        [staticDir, "--port", String(port), "--silent"],
        { cwd: buildFolder, stdio: "pipe", shell: isWindows, env: suppressWarningsEnv },
      );

      // Collect stderr for diagnostics
      let serverStderr: string = "";
      server.stderr?.on("data", (chunk: Buffer) => { serverStderr += chunk.toString(); });

      // Promise that rejects if server exits or errors before tests start
      const serverFailure: Promise<never> = new Promise<never>((_resolve, reject) => {
        server.on("exit", (code: number | null) => {
          reject(new Error(`http-server exited with code ${code ?? "null"}: ${serverStderr}`));
        });
        server.on("error", (err: Error) => {
          reject(new Error(`http-server spawn error: ${err.message}`));
        });
      });

      try {
        // Race: wait for port OR server crash — whichever comes first
        await Promise.race([
          waitForPort(port, SERVER_READY_TIMEOUT_MS),
          serverFailure,
        ]);

        session.logger.terminal.writeLine("Storybook server ready. Running interaction tests...");

        // Capture stderr via pipe — on success discard it (suppresses Jest
        // noise that heft treats as warnings); on failure print it.
        try {
          execFileSync(testStorybookBin, ["--url", `http://127.0.0.1:${port}`], {
            cwd: buildFolder,
            stdio: ["ignore", "inherit", "pipe"],
            shell: isWindows,
            env: suppressWarningsEnv,
          });
        } catch (err: unknown) {
          const execErr: { stderr?: Buffer } = err as { stderr?: Buffer };
          if (execErr.stderr && execErr.stderr.length > 0) {
            session.logger.terminal.writeErrorLine(execErr.stderr.toString());
          }
          throw err;
        }

        session.logger.terminal.writeLine("Storybook interaction tests completed.");
      } finally {
        server.kill();
      }
    });
  }
}

export default StorybookTestPlugin;
