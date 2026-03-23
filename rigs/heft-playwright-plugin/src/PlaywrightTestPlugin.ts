import { spawnSync } from "child_process";
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
      const playwrightCliPath: string = require.resolve("@playwright/test/cli", { paths: [buildFolder] });

      session.logger.terminal.writeLine(`Running Playwright tests via ${playwrightCliPath}`);
      const result = spawnSync(process.execPath, [playwrightCliPath, "test"], {
        cwd: buildFolder,
        stdio: "inherit",
      });
      if (result.error) {
        throw result.error;
      }
      session.logger.terminal.writeLine(`Playwright exited with code ${result.status}`);
      if (result.status !== 0) {
        throw new Error(`Playwright tests exited with code ${result.status}`);
      }
      session.logger.terminal.writeLine("Playwright tests completed.");
    });
  }
}

export default PlaywrightTestPlugin;
