import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(_execFile);

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

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
