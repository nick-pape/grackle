import { execFileSync } from "child_process";
import * as path from "path";
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "vitest-plugin";

/** Heft task plugin that runs vitest. */
class VitestPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      const buildFolder: string = heftConfiguration.buildFolderPath;
      const isWindows: boolean = process.platform === "win32";
      const executableName: string = isWindows ? "vitest.cmd" : "vitest";
      const vitestBin: string = path.join(buildFolder, "node_modules", ".bin", executableName);

      session.logger.terminal.writeLine("Running vitest...");
      execFileSync(vitestBin, ["run"], {
        cwd: buildFolder,
        stdio: "inherit",
        shell: isWindows,
      });
      session.logger.terminal.writeLine("Vitest completed.");
    });
  }
}

export default VitestPlugin;
