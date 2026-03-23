import type { AdapterLogger } from "./logger.js";
import type { ExecResult } from "./exec.js";

/** Function signature for executing local commands. */
export type ExecFunction = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** Injectable dependencies for environment adapters. */
export interface AdapterDependencies {
  /** Execute a local command (default: child_process.execFile wrapper). */
  exec?: ExecFunction;
  /** Async sleep (default: setTimeout-based). */
  sleep?: (ms: number) => Promise<void>;
  /** Logger (default: adapter-sdk's defaultLogger). */
  logger?: AdapterLogger;
  /** Whether the GitHub credential provider is enabled (default: false). */
  isGitHubProviderEnabled?: () => boolean;
}
