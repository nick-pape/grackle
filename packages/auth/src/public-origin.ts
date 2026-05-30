/**
 * Validate and normalize a browser-facing public origin (e.g. `https://grackle.home`),
 * the value of `GRACKLE_PUBLIC_URL` / `WebServerOptions.publicUrl`.
 *
 * Accepts only a bare http(s) origin: leading/trailing whitespace is trimmed, and
 * a path, query, fragment, or embedded userinfo (`user:pass@host`) is rejected.
 * Userinfo in particular is refused rather than silently dropped by `URL.origin`,
 * and its error message never echoes the raw value so credentials cannot leak into
 * logs. Throws an `Error` with a clear, label-prefixed message on any invalid
 * input so callers fail fast at startup.
 *
 * @param value - The raw origin string (may contain surrounding whitespace).
 * @param label - Human-readable source name for error messages (e.g. `GRACKLE_PUBLIC_URL`).
 * @returns The parsed `URL`; use `.origin` for the normalized string form.
 */
export function parsePublicOrigin(value: string, label: string): URL {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid ${label}: must be an absolute http(s) origin, e.g. https://grackle.home.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label}: Scheme must be http or https.`);
  }
  if (parsed.username || parsed.password) {
    // Do NOT echo the raw value — it contains credentials.
    throw new Error(`Invalid ${label}: must not contain a username or password (userinfo).`);
  }
  if ((parsed.pathname !== "" && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error(`Invalid ${label}: must be a bare origin with no path, query, or fragment.`);
  }
  return parsed;
}
