/**
 * Pure helpers for bucketing tasks into Kanban board columns.
 *
 * Unlike the sidebar `groupTasksByStatus()` (which adds a virtual "blocked"
 * group), the board keeps blocked tasks in their actual-status column and
 * overlays a badge.
 */

import type { TaskData } from "../hooks/useGrackleSocket.js";
import { BOARD_COLUMN_ORDER, getStatusStyle, resolveStatus, type TaskStatusKey, type TaskStatusStyle } from "./taskStatus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a single column on the Kanban board. */
export interface BoardColumn {
  /** Canonical status key (e.g. "working"). */
  status: TaskStatusKey;
  /** Human-readable column heading. */
  label: string;
  /** Visual style for the column header. */
  style: TaskStatusStyle;
  /** Tasks in this column, sorted by `sortOrder`. */
  tasks: BoardTask[];
}

/** A task decorated with board-specific computed properties. */
export interface BoardTask {
  /** Original task data. */
  task: TaskData;
  /** True when the task has unresolved dependencies. */
  isBlocked: boolean;
  /** Number of direct child tasks. */
  childCount: number;
  /** Number of direct child tasks that are complete. */
  doneChildCount: number;
  /** Paused sub-badge label derived from latest session status. */
  pausedSubBadge?: "Needs input" | "Ready to complete";
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/** Options for building board columns. */
interface BuildColumnsOptions {
  /** Flat list of tasks belonging to one workspace. */
  tasks: TaskData[];
  /** Map of taskId → status for all tasks (used for dependency checking). */
  taskStatusById: Map<string, string>;
  /** Map of taskId → latest session status (used for paused sub-badges). */
  sessionStatusByTaskId?: Map<string, string>;
  /** Map of taskId → latest session endReason (used for paused sub-badges). */
  sessionEndReasonByTaskId?: Map<string, string>;
}

/**
 * Bucket tasks into fixed board columns.
 *
 * - Always returns all five columns (empty ones get an empty `tasks` array).
 * - Resolves legacy status aliases to canonical keys.
 * - Sorts tasks within each column by `sortOrder`.
 * - Computes blocked state and child-progress counts.
 * - Derives paused sub-badges from the latest session status.
 */
export function buildBoardColumns({
  tasks,
  taskStatusById,
  sessionStatusByTaskId,
  sessionEndReasonByTaskId,
}: BuildColumnsOptions): BoardColumn[] {
  // Index children by parent
  const childrenByParent = new Map<string, TaskData[]>();
  for (const t of tasks) {
    if (t.parentTaskId) {
      const list = childrenByParent.get(t.parentTaskId);
      if (list) {
        list.push(t);
      } else {
        childrenByParent.set(t.parentTaskId, [t]);
      }
    }
  }

  // Pre-build empty buckets keyed by status
  const buckets = new Map<TaskStatusKey, BoardTask[]>(
    BOARD_COLUMN_ORDER.map((s) => [s, []]),
  );

  for (const task of tasks) {
    const column = resolveStatus(task.status);
    const isBlocked =
      task.dependsOn.length > 0 &&
      task.dependsOn.some((depId) => taskStatusById.get(depId) !== "complete");

    const children = childrenByParent.get(task.id) ?? [];
    const childCount = children.length;
    const doneChildCount = children.filter((c) => c.status === "complete").length;

    let pausedSubBadge: BoardTask["pausedSubBadge"];
    if (column === "paused" && sessionStatusByTaskId) {
      const sessionStatus = sessionStatusByTaskId.get(task.id);
      const endReason = sessionEndReasonByTaskId?.get(task.id);
      if (sessionStatus === "idle" && endReason === "completed") {
        pausedSubBadge = "Ready to complete";
      } else if (sessionStatus === "idle") {
        pausedSubBadge = "Needs input";
      }
    }

    const boardTask: BoardTask = {
      task,
      isBlocked,
      childCount,
      doneChildCount,
      pausedSubBadge,
    };

    const bucket = buckets.get(column);
    if (bucket) {
      bucket.push(boardTask);
    } else {
      // Unknown status → fall back to not_started column
      buckets.get("not_started")!.push(boardTask);
    }
  }

  // Sort tasks in each bucket by sortOrder
  for (const columnTasks of buckets.values()) {
    columnTasks.sort((a, b) => a.task.sortOrder - b.task.sortOrder);
  }

  // Build final column array in display order
  return BOARD_COLUMN_ORDER.map((status) => {
    const style = getStatusStyle(status);

    return {
      status,
      label: style.label,
      style,
      tasks: buckets.get(status) ?? [],
    };
  });
}
