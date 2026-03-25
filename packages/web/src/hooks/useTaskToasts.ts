import { useEffect, useRef } from "react";
import type { TaskData } from "./types.js";
import type { ToastVariant } from "../context/ToastContext.js";
import { diffTasksForToasts } from "./taskToastHelpers.js";

/**
 * Diffs the previous and current task lists and fires toast
 * notifications for meaningful status transitions.
 *
 * Skips toasts on initial load (when the previous ref is undefined)
 * and for transitions to `not_started` (no user action needed).
 */
export function useTaskToasts(
  tasks: TaskData[],
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void,
): void {
  const prevRef = useRef<TaskData[] | undefined>(undefined);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = tasks;

    const toasts = diffTasksForToasts(prev, tasks);
    for (const toast of toasts) {
      showToast(toast.message, toast.variant);
    }
  }, [tasks, showToast]);
}
