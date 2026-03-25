import type { ToastVariant } from "../context/ToastContext.js";
import type { TaskData } from "./types.js";

/** Descriptor for a toast to display after a task state change. */
export interface TaskToastDescriptor {
  message: string;
  variant: ToastVariant;
}

/** Maps canonical task status keys to toast descriptors. */
const TASK_STATUS_TOAST_MAP: Record<string, TaskToastDescriptor> = {
  working:  { message: "Task started",   variant: "info" },
  paused:   { message: "Task paused",    variant: "warning" },
  complete: { message: "Task completed", variant: "success" },
  failed:   { message: "Task failed",    variant: "error" },
};

/**
 * Map a task status string to a toast descriptor.
 * Returns `undefined` for statuses that should not produce toasts
 * (e.g. `"not_started"`, unknown values).
 */
export function taskStatusToToast(status: string): TaskToastDescriptor | undefined {
  return TASK_STATUS_TOAST_MAP[status];
}

/**
 * Compare previous and current task arrays, returning an array of
 * toast descriptors for meaningful status transitions.
 *
 * Returns an empty array if `previous` is `undefined` (initial load — no
 * toasts should fire when the app first connects).
 */
export function diffTasksForToasts(
  previous: TaskData[] | undefined,
  current: TaskData[],
): TaskToastDescriptor[] {
  if (previous === undefined) {
    return [];
  }

  const results: TaskToastDescriptor[] = [];

  const prevMap = new Map<string, TaskData>();
  for (const task of previous) {
    prevMap.set(task.id, task);
  }

  const currentIds = new Set<string>();

  for (const task of current) {
    currentIds.add(task.id);
    const old = prevMap.get(task.id);

    // New task added — skip (creation has its own UX in TaskEditPanel)
    if (!old) {
      continue;
    }

    // No status change
    if (old.status === task.status) {
      continue;
    }

    const toast = taskStatusToToast(task.status);
    if (toast) {
      results.push(toast);
    }
  }

  // Check for removed tasks
  for (const old of previous) {
    if (!currentIds.has(old.id)) {
      results.push({ message: "Task deleted", variant: "info" });
    }
  }

  return results;
}
