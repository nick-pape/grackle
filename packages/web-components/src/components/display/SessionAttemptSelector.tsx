import type { JSX } from "react";
import type { Session } from "../../hooks/types.js";
import styles from "./SessionAttemptSelector.module.scss";

/** Props for {@link SessionAttemptSelector}. */
export interface SessionAttemptSelectorProps {
  /** All sessions (attempts) for a task, ordered chronologically. */
  taskSessions: Session[];
  /** The currently selected session id. */
  selectedSessionId: string | undefined;
  /** Called when the user clicks an attempt button. */
  onSelect: (sessionId: string) => void;
}

/**
 * Displays a row of numbered attempt buttons when a task has multiple sessions.
 * Returns `undefined` when fewer than two sessions exist.
 */
export function SessionAttemptSelector({ taskSessions, selectedSessionId, onSelect }: SessionAttemptSelectorProps): JSX.Element | undefined {
  if (taskSessions.length < 2) {
    return undefined;
  }
  return (
    <div className={styles.attemptSelector} data-testid="attempt-selector">
      <span className={styles.attemptLabel}>Attempts:</span>
      {taskSessions.map((s, i) => {
        const isActive = s.id === selectedSessionId;
        const statusIcon = s.status === "stopped" && s.endReason === "completed" ? "\u2713"
          : s.status === "stopped" ? "\u2717"
          : s.status === "running" || s.status === "idle" ? "\u25CF"
          : "";
        return (
          <button
            key={s.id}
            className={`${styles.attemptButton} ${isActive ? styles.attemptActive : ""}`}
            onClick={() => onSelect(s.id)}
            title={`Attempt #${i + 1} -- ${s.status}`}
            aria-label={`Attempt #${i + 1}, ${s.status}`}
            aria-pressed={isActive}
            data-testid={`attempt-${i + 1}`}
          >
            #{i + 1}
            {statusIcon && <span className={styles.attemptStatus}>{statusIcon}</span>}
          </button>
        );
      })}
    </div>
  );
}
