import { useState, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import { Spinner } from "../components/display/index.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Home page shown when no specific entity is selected. */
export function EmptyPage(): JSX.Element {
  const { workspaces, environments, createWorkspace, workspaceCreating } = useGrackle();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  const hasEnvironments = environments.length > 0;

  /** Submit the inline create form. */
  const handleCreateWorkspace = (): void => {
    if (!newWorkspaceName.trim() || workspaceCreating || !hasEnvironments) {
      return;
    }
    createWorkspace(newWorkspaceName.trim(), undefined, undefined, environments[0].id);
  };

  if (workspaces.length === 0) {
    return (
      <div className={styles.emptyCta} data-testid="welcome-cta">
        <div className={styles.ctaTitle}>Welcome to Grackle</div>
        <div className={styles.ctaDescription}>
          Organize your work into workspaces and let agents tackle the tasks.
        </div>
        {showCreateForm ? (
          <div className={styles.ctaCreateForm}>
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleCreateWorkspace();
                } else if (e.key === "Escape") {
                  setShowCreateForm(false);
                  setNewWorkspaceName("");
                }
              }}
              placeholder="Workspace name..."
              aria-label="Workspace name"
              autoFocus
              disabled={workspaceCreating}
              className={styles.ctaCreateInput}
              data-testid="welcome-create-input"
            />
            <button
              onClick={handleCreateWorkspace}
              className={styles.ctaCreateOk}
              disabled={workspaceCreating}
              aria-label={workspaceCreating ? "Creating workspace" : undefined}
              data-testid="welcome-create-ok"
            >
              {workspaceCreating
                ? <Spinner size="sm" label="Creating workspace" />
                : "OK"}
            </button>
          </div>
        ) : (
          <button
            className={styles.ctaButton}
            onClick={() => setShowCreateForm(true)}
            disabled={workspaceCreating || !hasEnvironments}
            data-testid="welcome-create-button"
          >
            Create Your First Workspace
          </button>
        )}
        {!hasEnvironments && (
          <div className={styles.ctaDescription}>
            Add an environment first via Settings before creating a workspace.
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={styles.emptyState}>
      Select a workspace or task to get started
    </div>
  );
}
