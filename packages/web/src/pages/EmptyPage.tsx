import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Home page shown when no specific entity is selected. */
export function EmptyPage(): JSX.Element {
  const { projects, createProject } = useGrackle();

  if (projects.length === 0) {
    return (
      <div className={styles.emptyCta}>
        <div className={styles.ctaTitle}>Welcome to Grackle</div>
        <div className={styles.ctaDescription}>
          Organize your work into projects and let agents tackle the tasks.
        </div>
        <button
          className={styles.ctaButton}
          onClick={() => {
            const name = window.prompt("Project name:");
            if (name?.trim()) {
              createProject(name.trim());
            }
          }}
        >
          Create Your First Project
        </button>
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      Select a project or task to get started
    </div>
  );
}
