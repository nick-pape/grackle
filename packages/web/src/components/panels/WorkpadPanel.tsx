import type { JSX } from "react";
import styles from "./WorkpadPanel.module.scss";

/** Props for the WorkpadPanel component. */
export interface WorkpadPanelProps {
  /** Raw JSON string from the task's workpad field. */
  workpad: string;
}

/** Parsed workpad shape. */
interface ParsedWorkpad {
  status?: string;
  summary?: string;
  extra?: Record<string, unknown>;
}

/**
 * Displays a task's workpad (persistent structured context).
 * Pure presentational — accepts the raw JSON string and renders
 * status, summary, and extra fields if present.
 */
export function WorkpadPanel({ workpad }: WorkpadPanelProps): JSX.Element | undefined {
  if (!workpad) {
    return undefined;
  }

  let parsed: ParsedWorkpad;
  try {
    const raw: unknown = JSON.parse(workpad);
    if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    parsed = raw as ParsedWorkpad;
  } catch {
    return (
      <div className={styles.workpadSection} data-testid="workpad-panel">
        <div className={styles.workpadLabel}>Workpad</div>
        <div className={styles.workpadExtra}>{workpad}</div>
      </div>
    );
  }

  if (!parsed.status && !parsed.summary && !parsed.extra) {
    return undefined;
  }

  return (
    <div className={styles.workpadSection} data-testid="workpad-panel">
      <div className={styles.workpadLabel}>Workpad</div>
      {parsed.status && (
        <div className={styles.workpadStatus} data-testid="workpad-status">{parsed.status}</div>
      )}
      {parsed.summary && (
        <div className={styles.workpadSummary} data-testid="workpad-summary">{parsed.summary}</div>
      )}
      {parsed.extra && Object.keys(parsed.extra).length > 0 && (
        <div className={styles.workpadExtra} data-testid="workpad-extra">
          {JSON.stringify(parsed.extra, null, 2)}
        </div>
      )}
    </div>
  );
}
