import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "vite-build-plugin";

/** Heft task plugin that runs Vite's Node API to produce a production build. */
class ViteBuildPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      session.logger.terminal.writeLine("Starting Vite build...");

      const { build } = await import("vite");
      await build({ root: heftConfiguration.buildFolderPath });

      session.logger.terminal.writeLine("Vite build completed.");
    });
  }
}

export default ViteBuildPlugin;
