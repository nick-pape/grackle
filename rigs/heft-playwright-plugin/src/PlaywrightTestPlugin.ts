import { execFileSync } from "child_process";
import * as path from "path";
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "playwright-test-plugin";

/** Heft task plugin that runs Playwright E2E tests. */
class PlaywrightTestPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      const buildFolder: string = heftConfiguration.buildFolderPath;
      const isWindows: boolean = process.platform === "win32";
      const executableName: string = isWindows ? "playwright.cmd" : "playwright";
      const playwrightBin: string = path.join(buildFolder, "node_modules", ".bin", executableName);

      session.logger.terminal.writeLine("Running Playwright tests...");
      execFileSync(playwrightBin, ["test"], {
        cwd: buildFolder,
        stdio: "inherit",
        shell: isWindows
      });
      session.logger.terminal.writeLine("Playwright tests completed.");
    });
  }
}

export default PlaywrightTestPlugin;
