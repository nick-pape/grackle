import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { DashboardPage } from "./DashboardPage.js";
import { NEW_WORKSPACE_URL, useAppNavigate } from "@grackle-ai/web-components";
import styles from "./page-layout.module.scss";

/** Empty page shown at /tasks when no task is selected. */
export function TasksEmptyPage(): JSX.Element {
  return (
    <div className={styles.emptyState}>
      Select a task or click + to create one
    </div>
  );
}

/** Empty page shown at /environments when no environment is selected. */
export function EnvironmentsEmptyPage(): JSX.Element {
  return (
    <div className={styles.emptyState}>
      Select an environment to manage its workspaces, or add a new one.
    </div>
  );
}

/** Home page — shows the operations dashboard when workspaces exist, or the welcome CTA for first-time users. */
export function EmptyPage(): JSX.Element {
  const { workspaces, environments } = useGrackle();
  const navigate = useAppNavigate();

  const hasEnvironments = environments.length > 0;

  // Show dashboard when workspaces exist
  if (workspaces.length > 0) {
    return <DashboardPage />;
  }

  // Zero-workspace onboarding CTA
  return (
    <div className={styles.emptyCta} data-testid="welcome-cta">
      <div className={styles.ctaTitle}>Welcome to Grackle</div>
      <div className={styles.ctaDescription}>
        Organize your work into workspaces and let agents tackle the tasks.
      </div>
      <button
        className={styles.ctaButton}
        onClick={() => navigate(NEW_WORKSPACE_URL)}
        disabled={!hasEnvironments}
        data-testid="welcome-create-button"
      >
        Create Your First Workspace
      </button>
      {!hasEnvironments && (
        <div className={styles.ctaDescription}>
          Add an environment first before creating a workspace.
        </div>
      )}
    </div>
  );
}
