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
      // Resolve @playwright/test's CLI directly from lockfile-installed packages.
      // Do NOT use node_modules/.bin/playwright — pnpm may hoist the base
      // `playwright` package there instead of `@playwright/test`, and the base
      // package exits 1 for flaky tests while @playwright/test exits 0.
      const playwrightCliPath: string = require.resolve("@playwright/test/cli", { paths: [buildFolder] });

      session.logger.terminal.writeLine("Running Playwright tests...");
      execFileSync(process.execPath, [playwrightCliPath, "test"], {
        cwd: buildFolder,
        stdio: "inherit",
      });
      session.logger.terminal.writeLine("Playwright tests completed.");
    });
  }
}

export default PlaywrightTestPlugin;
