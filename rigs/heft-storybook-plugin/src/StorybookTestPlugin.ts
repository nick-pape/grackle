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

/** Port used to serve the static Storybook build during testing. */
const STORYBOOK_PORT: number = 6006;

/** Maximum time (ms) to wait for the HTTP server to accept connections. */
const SERVER_READY_TIMEOUT_MS: number = 30_000;

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

      session.logger.terminal.writeLine("Starting Storybook static server...");

      const server: ChildProcess = spawn(
        httpServerBin,
        [staticDir, "--port", String(STORYBOOK_PORT), "--silent"],
        { cwd: buildFolder, stdio: "inherit", shell: isWindows },
      );

      try {
        await waitForPort(STORYBOOK_PORT, SERVER_READY_TIMEOUT_MS);
        session.logger.terminal.writeLine("Storybook server ready. Running interaction tests...");

        execFileSync(testStorybookBin, ["--url", `http://127.0.0.1:${STORYBOOK_PORT}`], {
          cwd: buildFolder,
          stdio: "inherit",
          shell: isWindows,
          env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1", CI: "true" },
        });

        session.logger.terminal.writeLine("Storybook interaction tests completed.");
      } finally {
        server.kill();
      }
    });
  }
}

export default StorybookTestPlugin;
