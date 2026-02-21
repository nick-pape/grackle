import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(_execFile);

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
    timeout: opts?.timeout ?? 60_000,
    cwd: opts?.cwd,
    env: opts?.env ?? process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
