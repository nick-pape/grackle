import { useState, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { Spinner } from "../components/display/index.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Home page shown when no specific entity is selected. */
export function EmptyPage(): JSX.Element {
  const { projects, createProject, projectCreating } = useGrackle();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  /** Submit the inline create form. */
  const handleCreateProject = (): void => {
    if (!newProjectName.trim() || projectCreating) {
      return;
    }
    createProject(newProjectName.trim());
    setNewProjectName("");
    setShowCreateForm(false);
  };

  if (projects.length === 0) {
    return (
      <div className={styles.emptyCta} data-testid="welcome-cta">
        <div className={styles.ctaTitle}>Welcome to Grackle</div>
        <div className={styles.ctaDescription}>
          Organize your work into projects and let agents tackle the tasks.
        </div>
        {showCreateForm ? (
          <div className={styles.ctaCreateForm}>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateProject();
                } else if (e.key === "Escape") {
                  setShowCreateForm(false);
                  setNewProjectName("");
                }
              }}
              placeholder="Project name..."
              autoFocus
              disabled={projectCreating}
              className={styles.ctaCreateInput}
              data-testid="welcome-create-input"
            />
            <button
              onClick={handleCreateProject}
              className={styles.ctaCreateOk}
              disabled={projectCreating}
              data-testid="welcome-create-ok"
            >
              {projectCreating
                ? <Spinner size="sm" label="Creating project" />
                : "OK"}
            </button>
          </div>
        ) : (
          <button
            className={styles.ctaButton}
            onClick={() => setShowCreateForm(true)}
            data-testid="welcome-create-button"
          >
            Create Your First Project
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      Select a project or task to get started
    </div>
  );
}
