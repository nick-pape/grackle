/**
 * Pure helper for the Sessions page header summary.
 *
 * Kept in its own module (free of any `@grackle-ai/web-components` barrel
 * import) so it can be unit-tested under vitest — importing the barrel pulls in
 * the dagre-backed coordination graph, which fails to resolve in vitest.
 *
 * @module
 */

/** Build the one-line summary shown under the Sessions page title. */
export function buildSummary(
  sessionCount: number,
  activeCount: number,
  environmentCount: number,
): string {
  if (sessionCount === 0) {
    return "No sessions yet";
  }
  const sessionsLabel = sessionCount === 1 ? "session" : "sessions";
  const envLabel = environmentCount === 1 ? "environment" : "environments";
  return `${activeCount} active of ${sessionCount} ${sessionsLabel} across ${environmentCount} ${envLabel}`;
}
