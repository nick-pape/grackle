/**
 * Session-status display mapping. Sessions use a different status vocabulary than
 * tasks (running / stopped / suspended / idle / hibernating / ...), so this maps
 * a session status to a theme CSS-variable name and a human label. Shared by
 * `SessionNode` (card accent + label) and `CoordinationGraph` (MiniMap color) so
 * the two stay consistent.
 *
 * @module
 */

/** Capitalize the first letter of a status string for display. */
function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** A session-status visual: a theme CSS-variable name plus a display label. */
export interface SessionStatusStyle {
  /** Theme CSS variable name, e.g. `--accent-green`. */
  varName: string;
  /** Human-readable status label. */
  label: string;
}

/** Theme CSS-variable names this mapping can produce (for batch color resolution). */
export const SESSION_STATUS_VAR_NAMES: readonly string[] = [
  "--accent-green",
  "--accent-yellow",
  "--accent-red",
  "--text-tertiary",
];

/** Map a session status (and external flag) to its visual style. */
export function sessionStatusStyle(status: string, external: boolean): SessionStatusStyle {
  if (external) {
    return { varName: "--text-tertiary", label: "External" };
  }
  switch (status) {
    case "running":
      return { varName: "--accent-green", label: "Running" };
    case "idle":
    case "suspended":
    case "hibernating":
      return { varName: "--accent-yellow", label: capitalize(status) };
    case "failed":
    case "interrupted":
      return { varName: "--accent-red", label: capitalize(status) };
    default:
      // stopped, completed, unknown, etc.
      return {
        varName: "--text-tertiary",
        label: status.length > 0 ? capitalize(status) : "Unknown",
      };
  }
}
