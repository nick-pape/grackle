/**
 * Inline workspace management for an environment in Settings.
 *
 * @module
 */

import { useState, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { ConfirmDialog } from "../display/index.js";
import styles from "./EnvironmentList.module.scss";

/** Props for the EnvironmentWorkspaces component. */
interface EnvironmentWorkspacesProps {
  /** The environment ID to show workspaces for. */
  environmentId: string;
}

/**
 * Displays workspaces belonging to an environment with inline management.
 *
 * Shows a list of workspace rows with name and archive button, plus an
 * "Add Workspace" button that opens an inline creation form.
 */
export function EnvironmentWorkspaces({ environmentId }: EnvironmentWorkspacesProps): JSX.Element {
  const { workspaces, createWorkspace, archiveWorkspace, workspaceCreating } = useGrackle();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);

  const envWorkspaces = workspaces.filter((w) => w.environmentId === environmentId);
  const archiveTargetWorkspace = archiveTarget
    ? envWorkspaces.find((w) => w.id === archiveTarget)
    : undefined;

  /** Submit the inline create form. */
  const handleCreate = (): void => {
    if (!newName.trim() || workspaceCreating) {
      return;
    }
    createWorkspace(newName.trim(), undefined, undefined, environmentId);
    setNewName("");
    setShowCreateForm(false);
  };

  /** Confirm archive of a workspace. */
  const handleArchiveConfirm = (): void => {
    if (archiveTarget) {
      archiveWorkspace(archiveTarget);
      setArchiveTarget(null);
    }
  };

  return (
    <div data-testid="env-workspaces" style={{ padding: "0 0 var(--space-sm) 28px" }}>
      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Workspace?"
        description={
          archiveTargetWorkspace
            ? `"${archiveTargetWorkspace.name}" will be archived.`
            : "This workspace will be archived."
        }
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      {envWorkspaces.length === 0 && !showCreateForm && (
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-tertiary)", padding: "var(--space-xs) 0" }}>
          No workspaces
        </div>
      )}

      {envWorkspaces.map((w) => (
        <div
          key={w.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "var(--space-xs) 0",
            fontSize: "var(--font-size-sm)",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={w.name}>
            {w.name}
          </span>
          <button
            onClick={() => setArchiveTarget(w.id)}
            className={styles.deleteButton}
            style={{ marginLeft: "auto", fontSize: "11px", padding: "1px 6px" }}
            title="Archive workspace"
            aria-label={`Archive ${w.name}`}
          >
            Archive
          </button>
        </div>
      ))}

      {showCreateForm ? (
        <div style={{ display: "flex", gap: "var(--space-xs)", padding: "var(--space-xs) 0" }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCreate();
              } else if (e.key === "Escape") {
                setShowCreateForm(false);
                setNewName("");
              }
            }}
            placeholder="Workspace name..."
            autoFocus
            disabled={workspaceCreating}
            data-testid="workspace-name-input"
            style={{
              flex: 1,
              fontSize: "11px",
              padding: "3px var(--space-sm)",
              background: "var(--bg-input)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
            }}
          />
          <button
            onClick={handleCreate}
            disabled={workspaceCreating || !newName.trim()}
            data-testid="add-workspace-ok"
            className={styles.connectButton}
            style={{ fontSize: "11px", padding: "2px 8px" }}
          >
            OK
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreateForm(true)}
          data-testid="add-workspace-button"
          className={styles.connectButton}
          style={{ fontSize: "11px", padding: "2px 8px", marginTop: "var(--space-xs)" }}
        >
          + Add Workspace
        </button>
      )}
    </div>
  );
}
