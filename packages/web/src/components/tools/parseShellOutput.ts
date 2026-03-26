/**
 * Parses shell command output from different runtime formats.
 *
 * Codex emits `[exit N] output` format. Other runtimes emit plain output.
 */

/** Parsed shell command result. */
export interface ShellResult {
  /** Exit code, or undefined if not available. */
  exitCode: number | undefined;
  /** Command output (stdout/stderr). */
  output: string;
}

/** Pattern matching Codex's `[exit N] rest` format. */
const EXIT_CODE_PATTERN: RegExp = /^\[exit (\d+)\]\s*/;

/** Parses shell output, extracting exit code if present. */
export function parseShellOutput(content: string): ShellResult {
  const match: RegExpExecArray | null = EXIT_CODE_PATTERN.exec(content);
  if (match) {
    return {
      exitCode: Number(match[1]),
      output: content.slice(match[0].length),
    };
  }
  return { exitCode: undefined, output: content };
}
