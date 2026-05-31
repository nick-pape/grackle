/**
 * Convert a filesystem path to a `file://` URI for the live-docs resource
 * bridge (#1396). Returns `undefined` for relative paths — those can't be
 * resolved client-side without the session's working directory, so they are not
 * made clickable in v0 (coding-agent tools emit absolute paths).
 *
 * @param path - A filesystem path (POSIX absolute `/…` or Windows `C:\…`).
 * @returns A `file://` URI, or `undefined` when the path is relative.
 */
export function toFileUri(path: string): string | undefined {
  if (path.startsWith("/")) {
    // POSIX absolute: file:// + /abs/path → file:///abs/path
    return `file://${path}`;
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    // Windows absolute: C:\a\b → file:///C:/a/b
    return `file:///${path.replace(/\\/g, "/")}`;
  }
  return undefined;
}
