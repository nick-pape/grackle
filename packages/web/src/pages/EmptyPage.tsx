import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Home page shown when no specific entity is selected. */
export function EmptyPage(): JSX.Element {
  const { workspaces, createWorkspace } = useGrackle();

  if (workspaces.length === 0) {
    return (
      <div className={styles.emptyCta}>
        <div className={styles.ctaTitle}>Welcome to Grackle</div>
        <div className={styles.ctaDescription}>
          Organize your work into workspaces and let agents tackle the tasks.
        </div>
        <button
          className={styles.ctaButton}
          onClick={() => {
            const name = window.prompt("Workspace name:");
            if (name?.trim()) {
              createWorkspace(name.trim());
            }
          }}
        >
          Create Your First Workspace
        </button>
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      Select a workspace or task to get started
    </div>
  );
}
