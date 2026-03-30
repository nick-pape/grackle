import type { JSX } from "react";
import type { TaskData } from "../../hooks/types.js";
import styles from "./TaskActionButtons.module.scss";

/** Props for {@link TaskActionButtons}. */
export interface TaskActionButtonsProps {
  /** The task whose status drives which buttons are shown. */
  task: TaskData;
  /** Active session id — required to enable the Pause button. */
  sessionId: string | undefined;
  /** Whether the task is blocked by incomplete dependencies. */
  isBlocked: boolean;
  /** Start (or retry) the task. */
  onStart: () => void;
  /** Resume a paused task. */
  onResume: () => void;
  /** Stop the task. */
  onStop: () => void;
  /** Pause the task by killing its session. */
  onPause: () => void;
  /** Request task deletion (typically opens a confirm dialog). */
  onDelete: () => void;
  /** Open the task editor. */
  onEdit: () => void;
}

/**
 * Renders status-appropriate action buttons for a task.
 *
 * Which buttons appear depends on `task.status` and `isBlocked`.
 * Returns `undefined` for unrecognized statuses.
 */
export function TaskActionButtons({
  task, sessionId, isBlocked,
  onStart, onResume, onStop, onPause, onDelete, onEdit,
}: TaskActionButtonsProps): JSX.Element | undefined {
  if (task.status === "not_started") {
    if (isBlocked) {
      return (
        <div className={styles.actionButtons} data-testid="task-action-buttons">
          <button onClick={onEdit} className={styles.btnGhost} data-testid="task-action-edit">Edit</button>
          <button onClick={onDelete} className={styles.btnDanger} data-testid="task-action-delete">Delete</button>
        </div>
      );
    }
    return (
      <div className={styles.actionButtons} data-testid="task-action-buttons">
        <button data-testid="task-header-start" onClick={onStart} className={styles.btnPrimary}>Start</button>
        <button onClick={onEdit} className={styles.btnGhost} data-testid="task-action-edit">Edit</button>
        <button onClick={onDelete} className={styles.btnDanger} data-testid="task-action-delete">Delete</button>
      </div>
    );
  }
  if (task.status === "working") {
    return (
      <div className={styles.actionButtons} data-testid="task-action-buttons">
        <button onClick={onStop} className={styles.btnDanger} data-testid="task-action-stop">Stop</button>
        <button onClick={onPause} disabled={!sessionId} className={styles.btnGhost} data-testid="task-action-pause">Pause</button>
      </div>
    );
  }
  if (task.status === "paused") {
    return (
      <div className={styles.actionButtons} data-testid="task-action-buttons">
        <button onClick={onStop} className={styles.btnPrimary} data-testid="task-action-stop">Stop</button>
        <button onClick={onResume} className={styles.btnGhost} data-testid="task-action-resume">Resume</button>
        <button onClick={onDelete} className={styles.btnDanger} data-testid="task-action-delete">Delete</button>
      </div>
    );
  }
  if (task.status === "complete") {
    return (
      <div className={styles.actionButtons} data-testid="task-action-buttons">
        <button onClick={onDelete} className={styles.btnDanger} data-testid="task-action-delete">Delete</button>
      </div>
    );
  }
  if (task.status === "failed") {
    return (
      <div className={styles.actionButtons} data-testid="task-action-buttons">
        <button onClick={onStart} className={styles.btnPrimary} data-testid="task-header-start">Retry</button>
        <button onClick={onDelete} className={styles.btnDanger} data-testid="task-action-delete">Delete</button>
      </div>
    );
  }
  return undefined;
}
