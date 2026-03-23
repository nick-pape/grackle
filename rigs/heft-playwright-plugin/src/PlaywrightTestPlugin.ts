import { execFileSync } from "child_process";
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
      // Use @playwright/test's CLI entry point directly to ensure correct exit
      // code semantics. The base `playwright` package binary at node_modules/.bin
      // may have different behavior (e.g., exit 1 even when all tests pass).
      const playwrightCliPath: string = require.resolve("@playwright/test/cli", { paths: [buildFolder] });

      session.logger.terminal.writeLine("Running Playwright tests...");
      execFileSync(process.execPath, [playwrightCliPath, "test"], {
        cwd: buildFolder,
        stdio: "inherit",
        shell: false
      });
      session.logger.terminal.writeLine("Playwright tests completed.");
    });
  }
}

export default PlaywrightTestPlugin;
