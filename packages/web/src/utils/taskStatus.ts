/**
 * Shared task-status metadata: labels, icons, colors, and column order.
 *
 * Every view (sidebar, DAG, board, task page) should import from here so that
 * labels, icons, colors, and ordering stay consistent across the UI.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Canonical task statuses displayed in the UI. */
export type TaskStatusKey = "not_started" | "working" | "paused" | "complete" | "failed";

/** Virtual status for tasks with unresolved dependencies. Not stored on the task itself. */
export type VirtualStatus = "blocked";

/** All statuses the UI may display, including virtual ones. */
export type DisplayStatus = TaskStatusKey | VirtualStatus;

/** Visual metadata for a single task status. */
export interface TaskStatusStyle {
  /** CSS color value (typically a custom-property reference). */
  color: string;
  /** Single-character icon (Unicode). */
  icon: string;
  /** Human-readable label. */
  label: string;
}

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

/** Complete style map for every displayable status (canonical + virtual). */
export const TASK_STATUS_STYLES: Record<DisplayStatus, TaskStatusStyle> = {
  not_started: { color: "var(--text-tertiary)", icon: "\u25CB", label: "Not Started" },
  working:     { color: "var(--accent-green)",  icon: "\u25CF", label: "Working" },
  paused:      { color: "var(--accent-yellow)", icon: "\u25C9", label: "Paused" },
  complete:    { color: "var(--accent-green)",  icon: "\u2713", label: "Complete" },
  failed:      { color: "var(--accent-red)",    icon: "\u2717", label: "Failed" },
  blocked:     { color: "var(--accent-yellow)", icon: "\u29B8", label: "Blocked" },
};

/** Safe accessor — returns a style for any status string, falling back to `not_started`. */
export function getStatusStyle(status: string): TaskStatusStyle {
  return (TASK_STATUS_STYLES as Record<string, TaskStatusStyle>)[status] ?? TASK_STATUS_STYLES.not_started;
}

// ---------------------------------------------------------------------------
// CSS-class map for badge-style rendering (TaskPage)
// ---------------------------------------------------------------------------

/** Maps a canonical status key to a CSS class suffix used for badge coloring. */
export const STATUS_BADGE_CLASS_MAP: Record<string, string> = {
  not_started: "statusPending",
  working: "statusInProgress",
  paused: "statusWaitingInput",
  complete: "statusDone",
  failed: "statusFailed",
};

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/**
 * Sidebar group order — includes virtual "blocked" group.
 * This is the urgency-first ordering used by the sidebar grouped view.
 */
export const SIDEBAR_STATUS_ORDER: DisplayStatus[] = [
  "working", "paused", "failed", "not_started", "blocked", "complete",
];

/**
 * Board columns — the five concrete columns shown on the Kanban board.
 * "blocked" is NOT a column; blocked tasks stay in their original column
 * with a badge overlay.
 */
export const BOARD_COLUMN_ORDER: TaskStatusKey[] = [
  "not_started", "working", "paused", "complete", "failed",
];

// ---------------------------------------------------------------------------
// Alias resolution (legacy proto names → canonical)
// ---------------------------------------------------------------------------

/** Maps legacy / proto status strings to canonical UI status keys. */
const STATUS_ALIASES: Record<string, TaskStatusKey> = {
  pending: "not_started",
  assigned: "not_started",
  in_progress: "working",
  waiting_input: "paused",
  review: "paused",
  done: "complete",
};

/** Resolve a raw status string to a canonical `TaskStatusKey`, treating unknown values as `not_started`. */
export function resolveStatus(raw: string): TaskStatusKey {
  if (raw in TASK_STATUS_STYLES && raw !== "blocked") {
    return raw as TaskStatusKey;
  }
  return STATUS_ALIASES[raw] ?? "not_started";
}

// ---------------------------------------------------------------------------
// MiniMap color resolution (DagView)
// ---------------------------------------------------------------------------

/** CSS variable names used for MiniMap node coloring by task status. */
export const STATUS_CSS_VAR_MAP: Record<string, string> = {
  not_started: "--text-tertiary",
  working: "--accent-green",
  paused: "--accent-yellow",
  complete: "--accent-green",
  failed: "--accent-red",
  // Legacy aliases
  pending: "--text-tertiary",
  assigned: "--accent-blue",
  in_progress: "--accent-green",
  review: "--accent-yellow",
  done: "--accent-green",
  waiting_input: "--accent-yellow",
};
