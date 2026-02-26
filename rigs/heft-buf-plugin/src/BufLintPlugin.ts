import { execFileSync } from "child_process";
import * as path from "path";
import type {
  HeftConfiguration,
  IHeftTaskPlugin,
  IHeftTaskSession,
  IHeftTaskRunHookOptions
} from "@rushstack/heft";

const PLUGIN_NAME: string = "buf-lint-plugin";

/** Heft task plugin that runs `buf lint` for protobuf linting. */
class BufLintPlugin implements IHeftTaskPlugin {
  public apply(session: IHeftTaskSession, heftConfiguration: HeftConfiguration): void {
    session.hooks.run.tapPromise(PLUGIN_NAME, async (_runOptions: IHeftTaskRunHookOptions) => {
      const buildFolder: string = heftConfiguration.buildFolderPath;
      const isWindows: boolean = process.platform === "win32";
      const executableName: string = isWindows ? "buf.cmd" : "buf";
      const bufBin: string = path.join(buildFolder, "node_modules", ".bin", executableName);

      session.logger.terminal.writeLine("Running buf lint...");
      execFileSync(bufBin, ["lint"], {
        cwd: buildFolder,
        stdio: "inherit",
        shell: isWindows
      });
      session.logger.terminal.writeLine("buf lint completed.");
    });
  }
}

export default BufLintPlugin;
