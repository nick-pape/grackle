import { useState, useMemo, type JSX, type KeyboardEvent } from "react";
import { useParams, Navigate } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { ConfirmDialog, Spinner } from "../components/display/index.js";
import { environmentEditUrl, workspaceUrl, newChatUrl, useAppNavigate, ENVIRONMENTS_URL } from "../utils/navigation.js";
import type { Workspace } from "../hooks/useGrackleSocket.js";
import { formatCost } from "../utils/format.js";
import styles from "./EnvironmentDetailPage.module.scss";

/** Status-color mapping for the environment status badge. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

/** Detail page for a single environment — lifecycle controls and workspace cards. */
export function EnvironmentDetailPage(): JSX.Element {
  const { environmentId } = useParams<{ environmentId: string }>();
  const navigate = useAppNavigate();
  const {
    environments,
    workspaces,
    sessions,
    provisionStatus,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    createWorkspace,
    archiveWorkspace,
    workspaceCreating,
  } = useGrackle();

  const [showDeleteEnv, setShowDeleteEnv] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | undefined>(undefined);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");

  const env = environments.find((e) => e.id === environmentId);
  if (!environmentId || !env) {
    return <Navigate to={ENVIRONMENTS_URL} replace />;
  }

  const envWorkspaces = workspaces.filter((w) => w.environmentId === env.id);
  const envSessions = sessions.filter((s) => s.environmentId === env.id);
  const envCost = useMemo(() => envSessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0), [envSessions]);
  const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
  const isConnected = env.status === "connected";
  const isConnecting = env.status === "connecting";
  const isDisconnected = env.status === "disconnected" || env.status === "error";
  const progress = env.id in provisionStatus ? provisionStatus[env.id] : undefined;

  const handleDeleteEnv = (): void => {
    removeEnvironment(env.id);
    setShowDeleteEnv(false);
    navigate(ENVIRONMENTS_URL, { replace: true });
  };

  const handleCreateWorkspace = (): void => {
    if (!newWorkspaceName.trim() || workspaceCreating) {
      return;
    }
    createWorkspace(newWorkspaceName.trim(), undefined, undefined, env.id);
    setNewWorkspaceName("");
    setShowCreateForm(false);
  };

  const handleCreateKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      handleCreateWorkspace();
    } else if (e.key === "Escape") {
      setShowCreateForm(false);
      setNewWorkspaceName("");
    }
  };

  const handleArchive = (workspaceId: string): void => {
    archiveWorkspace(workspaceId);
    setConfirmArchiveId(undefined);
  };

  return (
    <div className={styles.container}>
      <ConfirmDialog
        isOpen={showDeleteEnv}
        title="Delete Environment?"
        description={`"${env.displayName || env.id}" will be permanently removed along with all its data.`}
        onConfirm={handleDeleteEnv}
        onCancel={() => setShowDeleteEnv(false)}
      />

      {/* Environment header */}
      <div className={styles.envHeader}>
        <div className={styles.envTitleRow}>
          <span className={styles.statusDot} style={{ color: statusColor }}>{"\u25CF"}</span>
          <h2 className={styles.envName}>{env.displayName || env.id}</h2>
          <span className={styles.statusBadge} style={{ color: statusColor }}>{env.status}</span>
        </div>
        <div className={styles.envMeta}>
          <span className={styles.metaTag}>Adapter: {env.adapterType}</span>
          {envSessions.length > 0 && (
            <span className={styles.metaTag}>{envSessions.length} session{envSessions.length !== 1 ? "s" : ""}</span>
          )}
          {envCost > 0 && (
            <span className={styles.metaTag}>Cost: {formatCost(envCost)}</span>
          )}
        </div>
      </div>

      {/* Lifecycle actions */}
      <div className={styles.actions}>
        {isConnected && (
          <>
            <button
              className={styles.btnPrimary}
              onClick={() => navigate(newChatUrl(env.id))}
            >
              New Chat
            </button>
            <button
              className={styles.btnOutline}
              onClick={() => stopEnvironment(env.id)}
            >
              Stop
            </button>
          </>
        )}
        {isDisconnected && (
          <button
            className={styles.btnPrimary}
            onClick={() => provisionEnvironment(env.id)}
          >
            {env.status === "error" ? "Retry" : "Connect"}
          </button>
        )}
        {isConnecting && progress !== undefined && (
          <span className={styles.provisionMessage}>{progress.message}</span>
        )}
        {env.status === "error" && progress?.stage === "error" && (
          <span className={styles.errorMessage}>{progress.message}</span>
        )}
        <button
          className={styles.btnOutline}
          onClick={() => navigate(environmentEditUrl(env.id))}
          data-testid="env-edit-btn"
        >
          Edit Config
        </button>
        <button
          className={styles.btnDanger}
          onClick={() => setShowDeleteEnv(true)}
        >
          Delete
        </button>
      </div>

      {/* Workspace cards */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Workspaces</h3>
          <button
            className={styles.btnPrimary}
            onClick={() => setShowCreateForm(true)}
            disabled={workspaceCreating}
          >
            + New Workspace
          </button>
        </div>

        {showCreateForm && (
          <div className={styles.createForm}>
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              placeholder="Workspace name..."
              autoFocus
              disabled={workspaceCreating}
              className={styles.createInput}
              data-testid="workspace-create-input"
            />
            <button
              onClick={handleCreateWorkspace}
              className={styles.btnPrimary}
              disabled={workspaceCreating || !newWorkspaceName.trim()}
              data-testid="workspace-create-submit"
            >
              {workspaceCreating ? <Spinner size="sm" label="Creating" /> : "Create"}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setNewWorkspaceName(""); }}
              className={styles.btnOutline}
            >
              Cancel
            </button>
          </div>
        )}

        {envWorkspaces.length === 0 && !showCreateForm && (
          <p className={styles.empty}>No workspaces yet. Create one to get started.</p>
        )}

        <div className={styles.cardList}>
          {envWorkspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              confirmArchiveId={confirmArchiveId}
              onOpen={() => navigate(workspaceUrl(ws.id))}
              onArchive={() => setConfirmArchiveId(ws.id)}
              onConfirmArchive={() => handleArchive(ws.id)}
              onCancelArchive={() => setConfirmArchiveId(undefined)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Props for the WorkspaceCard component. */
interface WorkspaceCardProps {
  /** Workspace data to display. */
  workspace: Workspace;
  /** ID of the workspace pending archive confirmation, or undefined. */
  confirmArchiveId: string | undefined;
  /** Navigate to the workspace detail page. */
  onOpen: () => void;
  /** Request archive confirmation. */
  onArchive: () => void;
  /** Confirm the archive action. */
  onConfirmArchive: () => void;
  /** Cancel the archive confirmation. */
  onCancelArchive: () => void;
}

/** Card displaying a workspace's summary with Open and Archive actions. */
function WorkspaceCard({
  workspace,
  confirmArchiveId,
  onOpen,
  onArchive,
  onConfirmArchive,
  onCancelArchive,
}: WorkspaceCardProps): JSX.Element {
  const isConfirming = confirmArchiveId === workspace.id;
  const isValidUrl = workspace.repoUrl && /^https?:\/\//.test(workspace.repoUrl);

  return (
    <div className={styles.card} data-testid="workspace-card">
      <div className={styles.cardHeader}>
        <strong className={styles.cardName}>{workspace.name}</strong>
        <div className={styles.cardActions}>
          <button className={styles.btnSmall} onClick={onOpen}>Open</button>
          {isConfirming ? (
            <>
              <button className={styles.btnDanger} onClick={onConfirmArchive}>Confirm</button>
              <button className={styles.btnSmall} onClick={onCancelArchive}>Cancel</button>
            </>
          ) : (
            <button className={styles.btnSmall} onClick={onArchive}>Archive</button>
          )}
        </div>
      </div>
      {workspace.description && (
        <p className={styles.cardDescription}>{workspace.description}</p>
      )}
      {workspace.repoUrl && (
        <div className={styles.cardMeta}>
          {isValidUrl ? (
            <a href={workspace.repoUrl} target="_blank" rel="noopener noreferrer" className={styles.repoLink}>
              {workspace.repoUrl}
            </a>
          ) : (
            <span>{workspace.repoUrl}</span>
          )}
        </div>
      )}
    </div>
  );
}
