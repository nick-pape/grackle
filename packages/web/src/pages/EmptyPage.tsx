import { type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { useAppNavigate } from "../utils/navigation.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Home page shown when no specific entity is selected. */
export function EmptyPage(): JSX.Element {
  const { environments } = useGrackle();
  const navigate = useAppNavigate();

  const hasEnvironments = environments.length > 0;

  return (
    <div className={styles.emptyCta} data-testid="welcome-cta">
      <div className={styles.ctaTitle}>Welcome to Grackle</div>
      <div className={styles.ctaDescription}>
        Select a task or create one to get started.
      </div>
      {hasEnvironments ? (
        <button
          className={styles.ctaButton}
          onClick={() => navigate("/tasks/new")}
          data-testid="welcome-create-button"
        >
          + Create Task
        </button>
      ) : (
        <div className={styles.ctaDescription}>
          Add an environment in Settings to get started.
        </div>
      )}
    </div>
  );
}
