import { execFileSync } from "child_process";
import * as fs from "fs";
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
      const npxName: string = isWindows ? "npx.cmd" : "npx";

      session.logger.terminal.writeLine("Building Storybook...");

      // Pipe stderr to /dev/null to suppress Rollup eval/chunk-size warnings
      // that Heft would otherwise treat as warnings (causing rush to exit 1).
      const devNull: number = fs.openSync(isWindows ? "NUL" : "/dev/null", "w");

      try {
        execFileSync(npxName, ["storybook", "build", "--quiet"], {
          cwd: buildFolder,
          stdio: ["ignore", "ignore", devNull],
          shell: isWindows,
          env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1", CI: "true" },
        });
      } finally {
        fs.closeSync(devNull);
      }

      session.logger.terminal.writeLine("Storybook build completed.");
    });
  }
}

export default StorybookBuildPlugin;
