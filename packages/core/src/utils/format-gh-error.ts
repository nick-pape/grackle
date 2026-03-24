/**
 * Translate a raw `gh` CLI error into a user-friendly message.
 * The raw error is still logged server-side for diagnostics.
 */
export function formatGhError(err: unknown, operation: string): string {
  const message = err instanceof Error ? err.message : String(err);
  const rawStderr =
    err instanceof Error && "stderr" in err
      ? (err as Error & { stderr: unknown }).stderr
      : undefined;
  const stderr =
    typeof rawStderr === "string" && rawStderr.length > 0
      ? rawStderr
      : Buffer.isBuffer(rawStderr) && rawStderr.length > 0
        ? rawStderr.toString()
        : "";
  const code =
    err instanceof Error && "code" in err
      ? String((err as Error & { code: unknown }).code)
      : "";

  if (code === "ENOENT" || message.includes("ENOENT")) {
    return "Could not find the `gh` CLI. Ensure GitHub CLI is installed and available on your system PATH, then restart the Grackle server.";
  }
  if (code === "EACCES" || message.includes("EACCES")) {
    return "`gh` CLI found but not executable. Check file permissions.";
  }
  const combined = `${stderr} ${message}`.toLowerCase();
  if (combined.includes("auth") || combined.includes("login")) {
    return "GitHub CLI is not authenticated. Run `gh auth login` and restart.";
  }
  return `Failed to ${operation}: ${stderr || message}`;
}
