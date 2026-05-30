import { execFileSync, spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as net from "net";
import { existsSync, readFileSync } from "fs";
import MCR = require("monocart-coverage-reports");
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions,
} from "@rushstack/heft";

const PLUGIN_NAME: string = "storybook-test-plugin";

/** When true, run `test-storybook --coverage` and convert the result to lcov (#1384). */
const COVERAGE_ENABLED: boolean = process.env.STORYBOOK_COVERAGE === "true";

/**
 * Convert the istanbul coverage map that `test-storybook --coverage` writes
 * (`coverage/storybook/coverage-storybook.json`) into
 * `coverage-storybook/lcov.info`, source-mapped to `packages/<pkg>/src` via
 * monocart's `baseDir`. Written to a sibling of `coverage/` so the parallel
 * Vitest task (which cleans `coverage/`) can't race-delete it. The merge tool
 * (`@grackle-ai/coverage-merge`) then unions it into the combined total.
 */
async function convertStorybookCoverage(
  buildFolder: string,
  log: (message: string) => void,
): Promise<void> {
  const istanbulJsonPath: string = path.join(
    buildFolder,
    "coverage",
    "storybook",
    "coverage-storybook.json",
  );
  // Fail loudly: with coverage requested, a missing istanbul file means
  // `test-storybook --coverage` stopped producing coverage (or it was deleted
  // before conversion). Skipping would make the coverage path silently
  // ineffective — the upload only warns and the merge doesn't require it.
  if (!existsSync(istanbulJsonPath)) {
    throw new Error(
      `STORYBOOK_COVERAGE is set but no coverage was produced at ${istanbulJsonPath}. ` +
        `Expected test-storybook --coverage to write it.`,
    );
  }
  const istanbulData: unknown = JSON.parse(readFileSync(istanbulJsonPath, "utf8"));
  const report: MCR.CoverageReport = new MCR.CoverageReport({
    name: "Grackle Storybook Coverage",
    outputDir: path.join(buildFolder, "coverage-storybook"),
    baseDir: path.join(buildFolder, "..", ".."),
    reports: ["lcovonly"],
    logging: "info",
  });
  await report.add(istanbulData as never);
  await report.generate();
  // Verify the lcov actually landed (guards against an empty/failed conversion).
  const lcovPath: string = path.join(buildFolder, "coverage-storybook", "lcov.info");
  if (!existsSync(lcovPath) || readFileSync(lcovPath, "utf8").trim().length === 0) {
    throw new Error(`Storybook coverage conversion produced no lcov at ${lcovPath}.`);
  }
  log("Storybook coverage written to coverage-storybook/lcov.info");
}

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
      const httpServerBin: string = path.join(
        buildFolder,
        "node_modules",
        ".bin",
        isWindows ? "http-server.cmd" : "http-server",
      );
      const testStorybookBin: string = path.join(
        buildFolder,
        "node_modules",
        ".bin",
        isWindows ? "test-storybook.cmd" : "test-storybook",
      );

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
      server.stderr?.on("data", (chunk: Buffer) => {
        serverStderr += chunk.toString();
      });

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
        await Promise.race([waitForPort(port, SERVER_READY_TIMEOUT_MS), serverFailure]);

        session.logger.terminal.writeLine("Storybook server ready. Running interaction tests...");

        // Capture stderr via pipe — on success discard it (suppresses Jest
        // noise that heft treats as warnings); on failure print it.
        const testArgs: string[] = ["--url", `http://127.0.0.1:${port}`];
        if (COVERAGE_ENABLED) {
          testArgs.push("--coverage");
        }
        try {
          execFileSync(testStorybookBin, testArgs, {
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

        if (COVERAGE_ENABLED) {
          await convertStorybookCoverage(buildFolder, (m) => session.logger.terminal.writeLine(m));
        }
      } finally {
        server.kill();
      }
    });
  }
}

export default StorybookTestPlugin;
