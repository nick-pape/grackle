import type { JSX } from "react";
import styles from "../components/panels/SessionPanel.module.scss";

/** Empty page shown at /tasks when no task is selected. */
export function TasksEmptyPage(): JSX.Element {
  return (
    <div className={styles.emptyState}>
      Select a task or click + to create one
    </div>
  );
}

/** Empty page shown at /workspaces when no workspace is selected. */
export function WorkspacesEmptyPage(): JSX.Element {
  return (
    <div className={styles.emptyState}>
      Select a workspace or task to get started
    </div>
  );
}
