import { execFileSync } from "child_process";
import * as path from "path";
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "storybook-build-plugin";

/** Heft task plugin that runs `storybook build` to produce a static Storybook site. */
class StorybookBuildPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      const buildFolder: string = heftConfiguration.buildFolderPath;
      const isWindows: boolean = process.platform === "win32";
      const executableName: string = isWindows ? "storybook.cmd" : "storybook";
      const storybookBin: string = path.join(buildFolder, "node_modules", ".bin", executableName);

      session.logger.terminal.writeLine("Building Storybook...");

      // Capture stderr via pipe. On success, discard it (suppresses Rollup
      // eval/chunk-size warnings that heft would treat as warnings, causing
      // rush to exit 1). On failure, print the captured stderr for debugging.
      try {
        execFileSync(storybookBin, ["build", "--quiet"], {
          cwd: buildFolder,
          stdio: ["ignore", "ignore", "pipe"],
          shell: isWindows,
          env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1", CI: "true" },
        });
      } catch (err: unknown) {
        const execErr: { stderr?: Buffer } = err as { stderr?: Buffer };
        if (execErr.stderr && execErr.stderr.length > 0) {
          session.logger.terminal.writeErrorLine(execErr.stderr.toString());
        }
        throw err;
      }

      session.logger.terminal.writeLine("Storybook build completed.");
    });
  }
}

export default StorybookBuildPlugin;
