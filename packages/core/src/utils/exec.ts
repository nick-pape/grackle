import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync: typeof _execFile.__promisify__ = promisify(_execFile);

const DEFAULT_EXEC_TIMEOUT_MS: number = 60_000;
const EXEC_MAX_BUFFER_BYTES: number = 10 * 1024 * 1024;

/** Trimmed stdout/stderr from a child process execution. */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a command as a child process and return its trimmed output.
 * @param cmd - Executable name or path.
 * @param args - Arguments to pass to the executable.
 * @param opts - Optional timeout, cwd, and env overrides.
 */
export async function exec(
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: opts?.timeout ?? DEFAULT_EXEC_TIMEOUT_MS,
    cwd: opts?.cwd,
    env: opts?.env ?? process.env,
    maxBuffer: EXEC_MAX_BUFFER_BYTES,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
