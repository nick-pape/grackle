import { useState, useCallback, type JSX } from "react";
import { useParams, Navigate } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import {
  ConfirmDialog,
  EditableTextField,
  ENVIRONMENTS_URL,
  NEW_WORKSPACE_URL,
  formatCost,
  isPortValid,
  newChatUrl,
  parseAdapterConfig,
  useAppNavigate,
  workspaceUrl,
} from "@grackle-ai/web-components";
import type { Workspace } from "../hooks/useGrackleSocket.js";
import { EnvironmentDetailShimmer } from "./EnvironmentDetailShimmer.js";
import styles from "./EnvironmentDetailPage.module.scss";

/** Status-color mapping for the environment status badge. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

/** Detail page for a single environment — lifecycle controls, inline config editing, and workspace cards. */
export function EnvironmentDetailPage(): JSX.Element {
  const { environmentId } = useParams<{ environmentId: string }>();
  const navigate = useAppNavigate();
  const {
    environments: {
      environments,
      environmentsLoading,
      provisionStatus,
      provisionEnvironment,
      stopEnvironment,
      removeEnvironment,
      updateEnvironment,
    },
    workspaces: {
      workspaces,
      archiveWorkspace,
      linkEnvironment,
      unlinkEnvironment,
      linkOperationError,
      clearLinkOperationError,
    },
    sessions: { sessions },
    githubAccounts: { githubAccounts },
  } = useGrackle();

  const [showDeleteEnv, setShowDeleteEnv] = useState(false);
  const [showReprovision, setShowReprovision] = useState(false);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | undefined>(undefined);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  const env = environments.find((e) => e.id === environmentId);

  if (!env && environmentsLoading) {
    return <EnvironmentDetailShimmer />;
  }

  if (!environmentId || !env) {
    return <Navigate to={ENVIRONMENTS_URL} replace />;
  }

  const config = parseAdapterConfig(env.adapterConfig);
  const envWorkspaces = workspaces.filter((w) => w.linkedEnvironmentIds.includes(env.id));
  const envSessions = sessions.filter((s) => s.environmentId === env.id);
  const envCost = envSessions.reduce((sum, s) => sum + (s.costMillicents ?? 0), 0);
  const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
  const isConnected = env.status === "connected";
  const isConnecting = env.status === "connecting";
  const isDisconnected =
    env.status === "disconnected" || env.status === "error" || env.status === "sleeping";
  const progress = env.id in provisionStatus ? provisionStatus[env.id] : undefined;

  const handleDeleteEnv = (): void => {
    removeEnvironment(env.id).catch(() => {});
    setShowDeleteEnv(false);
    navigate(ENVIRONMENTS_URL, { replace: true });
  };

  const handleReprovision = (): void => {
    setShowReprovision(false);
    provisionEnvironment(env.id, true).catch(() => {});
  };

  const handleArchive = (workspaceId: string): void => {
    archiveWorkspace(workspaceId).catch(() => {});
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
      <ConfirmDialog
        isOpen={showReprovision}
        title="Reprovision Environment?"
        description="This will kill any active session and force a fresh provision cycle. The environment will be temporarily disconnected."
        confirmLabel="Reprovision"
        onConfirm={handleReprovision}
        onCancel={() => setShowReprovision(false)}
      />

      {/* Environment header */}
      <div className={styles.envHeader}>
        <div className={styles.envTitleRow}>
          <span className={styles.statusDot} style={{ color: statusColor }}>
            {"●"}
          </span>
          <EditableTextField
            value={env.displayName || env.id}
            onSave={(value) => {
              updateEnvironment(env.id, { displayName: value }).catch(() => {});
            }}
            validate={(v) => (v.trim() === "" ? "Name cannot be empty" : undefined)}
            mode="edit"
            fieldId="env-name"
            activeFieldId={activeFieldId}
            onActivate={setActiveFieldId}
            placeholder="Environment name"
            ariaLabel="Environment name"
            data-testid="env-edit-name"
          />
          <span className={styles.statusBadge} style={{ color: statusColor }}>
            {env.status}
          </span>
        </div>
        <div className={styles.envMeta}>
          <span className={styles.metaTag}>Adapter: {env.adapterType}</span>
          {envSessions.length > 0 && (
            <span className={styles.metaTag}>
              {envSessions.length} session{envSessions.length !== 1 ? "s" : ""}
            </span>
          )}
          {envCost > 0 && <span className={styles.metaTag}>Cost: {formatCost(envCost)}</span>}
        </div>
      </div>

      {/* Lifecycle actions */}
      <div className={styles.actions}>
        {isConnected && (
          <>
            <button className={styles.btnPrimary} onClick={() => navigate(newChatUrl(env.id))}>
              New Chat
            </button>
            <button
              className={styles.btnOutline}
              onClick={() => {
                stopEnvironment(env.id).catch(() => {});
              }}
            >
              Stop
            </button>
            <button
              className={styles.btnOutline}
              onClick={() => setShowReprovision(true)}
              disabled={progress !== undefined}
              data-testid="env-reprovision-btn"
            >
              Reprovision
            </button>
          </>
        )}
        {isDisconnected && (
          <button
            className={styles.btnPrimary}
            onClick={() => {
              provisionEnvironment(env.id).catch(() => {});
            }}
          >
            {env.status === "error" ? "Retry" : env.status === "sleeping" ? "Wake" : "Connect"}
          </button>
        )}
        {isConnecting && progress !== undefined && (
          <span className={styles.provisionMessage}>{progress.message}</span>
        )}
        {env.status === "error" && progress?.stage === "error" && (
          <span className={styles.errorMessage}>{progress.message}</span>
        )}
        <button className={styles.btnDanger} onClick={() => setShowDeleteEnv(true)}>
          Delete
        </button>
      </div>

      {/* Inline configuration */}
      <EnvironmentConfigFields
        env={env}
        config={config}
        githubAccounts={githubAccounts}
        activeFieldId={activeFieldId}
        onActivate={setActiveFieldId}
        onUpdateEnvironment={updateEnvironment}
      />

      {/* Workspace cards */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Workspaces</h3>
          <button
            className={styles.btnPrimary}
            onClick={() =>
              navigate(`${NEW_WORKSPACE_URL}?environment=${encodeURIComponent(env.id)}`)
            }
            data-testid="workspace-create-button"
          >
            + New Workspace
          </button>
          {(() => {
            const linkable = workspaces.filter(
              (w) => !w.linkedEnvironmentIds.includes(env.id) && w.status === "active",
            );
            if (linkable.length === 0) {
              return null;
            }
            return (
              <select
                className={styles.btnPrimary}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    linkEnvironment(e.target.value, env.id).catch(() => {});
                  }
                }}
                aria-label="Link a workspace"
                data-testid="link-workspace-select"
              >
                <option value="">+ Link Workspace</option>
                {linkable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            );
          })()}
        </div>

        {linkOperationError && (
          <p className={styles.errorHint} data-testid="link-operation-error" role="alert">
            {linkOperationError}
            <button
              className={styles.btnSmall}
              onClick={clearLinkOperationError}
              aria-label="Dismiss error"
              data-testid="dismiss-link-error"
            >
              Dismiss
            </button>
          </p>
        )}

        {envWorkspaces.length === 0 && (
          <p className={styles.empty} data-testid="linked-workspaces-empty">
            No workspaces yet. Create one to get started.
          </p>
        )}

        <div className={styles.cardList} data-testid="linked-workspaces-list">
          {envWorkspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              confirmArchiveId={confirmArchiveId}
              onOpen={() => navigate(workspaceUrl(ws.id, env.id))}
              onArchive={() => setConfirmArchiveId(ws.id)}
              onConfirmArchive={() => handleArchive(ws.id)}
              onCancelArchive={() => setConfirmArchiveId(undefined)}
              onUnlink={() => {
                unlinkEnvironment(ws.id, env.id).catch(() => {});
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline configuration fields
// ---------------------------------------------------------------------------

interface EnvironmentConfigFieldsProps {
  env: { id: string; adapterType: string; adapterConfig: string; githubAccountId?: string };
  config: Record<string, unknown>;
  githubAccounts: Array<{
    id: string;
    label: string;
    username?: string;
    isDefault?: boolean;
  }>;
  activeFieldId: string | null; // eslint-disable-line @rushstack/no-new-null
  onActivate: (fieldId: string | null) => void; // eslint-disable-line @rushstack/no-new-null
  onUpdateEnvironment: (
    environmentId: string,
    fields: {
      displayName?: string;
      adapterConfig?: Record<string, unknown>;
      githubAccountId?: string;
    },
  ) => Promise<void>;
}

/** Renders adapter-specific editable config fields inline on the detail page. */
function EnvironmentConfigFields({
  env,
  config,
  githubAccounts,
  activeFieldId,
  onActivate,
  onUpdateEnvironment,
}: EnvironmentConfigFieldsProps): JSX.Element {
  const saveConfigField = useCallback(
    (fieldName: string, value: string) => {
      const current = parseAdapterConfig(env.adapterConfig);
      const trimmed = value.trim();
      if (trimmed) {
        current[fieldName] = trimmed;
      } else {
        delete current[fieldName];
      }
      onUpdateEnvironment(env.id, { adapterConfig: current }).catch(() => {});
    },
    [env, onUpdateEnvironment],
  );

  const saveConfigNumberField = useCallback(
    (fieldName: string, value: string) => {
      const current = parseAdapterConfig(env.adapterConfig);
      if (value.trim()) {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 1 && n <= 65535) {
          current[fieldName] = n;
        }
      } else {
        delete current[fieldName];
      }
      onUpdateEnvironment(env.id, { adapterConfig: current }).catch(() => {});
    },
    [env, onUpdateEnvironment],
  );

  return (
    <div className={styles.configSection} data-testid="env-config-section">
      <h3 className={styles.configHeading}>Configuration</h3>
      <div className={styles.configFields}>
        {/* Adapter Type (read-only) */}
        <div className={styles.configField}>
          <span className={styles.configLabel}>Adapter Type</span>
          <span className={styles.configValue} data-testid="env-edit-adapter-type">
            {env.adapterType}
          </span>
        </div>

        {/* GitHub Account (codespace and docker only) */}
        {(env.adapterType === "codespace" || env.adapterType === "docker") &&
          (githubAccounts.length > 0 || Boolean(env.githubAccountId)) && (
            <div className={styles.configField}>
              <span className={styles.configLabel}>GitHub Account</span>
              <select
                value={env.githubAccountId || ""}
                onChange={(e) => {
                  onUpdateEnvironment(env.id, { githubAccountId: e.target.value }).catch(() => {});
                }}
                className={styles.configSelect}
                data-testid="env-edit-github-account"
              >
                <option value="">(Default)</option>
                {githubAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {a.username ? ` (@${a.username})` : ""}
                    {a.isDefault ? " — default" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

        {/* Local adapter fields */}
        {env.adapterType === "local" && (
          <>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Host</span>
              <EditableTextField
                value={String(config.host ?? "")}
                onSave={(v) => saveConfigField("host", v)}
                mode="edit"
                fieldId="host"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="(default)"
                ariaLabel="Host"
                data-testid="env-edit-host"
              />
            </div>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Port</span>
              <EditableTextField
                value={String(config.port ?? "")}
                onSave={(v) => saveConfigNumberField("port", v)}
                validate={(v) => (!isPortValid(v) ? "Port must be 1-65535" : undefined)}
                mode="edit"
                fieldId="port"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="(default)"
                ariaLabel="Port"
                data-testid="env-edit-port"
              />
            </div>
          </>
        )}

        {/* SSH adapter fields */}
        {env.adapterType === "ssh" && (
          <>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Host</span>
              <EditableTextField
                value={String(config.host ?? "")}
                onSave={(v) => saveConfigField("host", v)}
                validate={(v) => (v.trim() === "" ? "Host is required" : undefined)}
                mode="edit"
                fieldId="host"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="hostname or IP"
                ariaLabel="Host"
                data-testid="env-edit-host"
              />
            </div>
            <div className={styles.configField}>
              <span className={styles.configLabel}>User</span>
              <EditableTextField
                value={String(config.user ?? "")}
                onSave={(v) => saveConfigField("user", v)}
                mode="edit"
                fieldId="user"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="(default)"
                ariaLabel="User"
                data-testid="env-edit-user"
              />
            </div>
            <div className={styles.configField}>
              <span className={styles.configLabel}>SSH Port</span>
              <EditableTextField
                value={String(config.sshPort ?? "")}
                onSave={(v) => saveConfigNumberField("sshPort", v)}
                validate={(v) => (!isPortValid(v) ? "Port must be 1-65535" : undefined)}
                mode="edit"
                fieldId="sshPort"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="22"
                ariaLabel="SSH Port"
                data-testid="env-edit-ssh-port"
              />
            </div>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Identity File</span>
              <EditableTextField
                value={String(config.identityFile ?? "")}
                onSave={(v) => saveConfigField("identityFile", v)}
                mode="edit"
                fieldId="identityFile"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="~/.ssh/id_rsa"
                ariaLabel="Identity File"
                data-testid="env-edit-identity-file"
              />
            </div>
          </>
        )}

        {/* Docker attach mode */}
        {env.adapterType === "docker" && config.attach !== undefined && (
          <div className={styles.configField}>
            <span className={styles.configLabel}>Attach (container)</span>
            <EditableTextField
              value={String(config.attach ?? "")}
              onSave={(v) => saveConfigField("attach", v)}
              validate={(v) => (v.trim() === "" ? "Container name is required" : undefined)}
              mode="edit"
              fieldId="attach"
              activeFieldId={activeFieldId}
              onActivate={onActivate}
              placeholder="container name or ID"
              ariaLabel="Attach container"
              data-testid="env-edit-attach"
            />
          </div>
        )}

        {/* Docker create mode */}
        {env.adapterType === "docker" && config.attach === undefined && (
          <>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Image</span>
              <EditableTextField
                value={String(config.image ?? "")}
                onSave={(v) => saveConfigField("image", v)}
                mode="edit"
                fieldId="image"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="(default)"
                ariaLabel="Image"
                data-testid="env-edit-image"
              />
            </div>
            <div className={styles.configField}>
              <span className={styles.configLabel}>Repo</span>
              <EditableTextField
                value={String(config.repo ?? "")}
                onSave={(v) => saveConfigField("repo", v)}
                mode="edit"
                fieldId="repo"
                activeFieldId={activeFieldId}
                onActivate={onActivate}
                placeholder="(none)"
                ariaLabel="Repo"
                data-testid="env-edit-repo"
              />
            </div>
          </>
        )}

        {/* Codespace adapter */}
        {env.adapterType === "codespace" && (
          <div className={styles.configField}>
            <span className={styles.configLabel}>Codespace Name</span>
            <EditableTextField
              value={String(config.codespaceName ?? "")}
              onSave={(v) => saveConfigField("codespaceName", v)}
              validate={(v) => (v.trim() === "" ? "Codespace name is required" : undefined)}
              mode="edit"
              fieldId="codespaceName"
              activeFieldId={activeFieldId}
              onActivate={onActivate}
              placeholder="codespace-name"
              ariaLabel="Codespace Name"
              data-testid="env-edit-codespace-name"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace card
// ---------------------------------------------------------------------------

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
  /** Unlink this workspace from the current environment. */
  onUnlink: () => void;
}

/** Card displaying a workspace's summary with Open, Unlink, and Archive actions. */
function WorkspaceCard({
  workspace,
  confirmArchiveId,
  onOpen,
  onArchive,
  onConfirmArchive,
  onCancelArchive,
  onUnlink,
}: WorkspaceCardProps): JSX.Element {
  const isConfirming = confirmArchiveId === workspace.id;
  const isValidUrl = workspace.repoUrl && /^https?:\/\//.test(workspace.repoUrl);

  return (
    <div className={styles.card} data-testid="workspace-card" data-workspace-id={workspace.id}>
      <div className={styles.cardHeader}>
        <strong className={styles.cardName}>{workspace.name}</strong>
        <div className={styles.cardActions}>
          <button className={styles.btnSmall} onClick={onOpen}>
            Open
          </button>
          <button
            className={styles.btnSmall}
            onClick={onUnlink}
            disabled={workspace.linkedEnvironmentIds.length <= 1}
            data-testid={`unlink-workspace-${workspace.id}`}
          >
            Unlink
          </button>
          {isConfirming ? (
            <>
              <button className={styles.btnDanger} onClick={onConfirmArchive}>
                Confirm
              </button>
              <button className={styles.btnSmall} onClick={onCancelArchive}>
                Cancel
              </button>
            </>
          ) : (
            <button className={styles.btnSmall} onClick={onArchive}>
              Archive
            </button>
          )}
        </div>
      </div>
      {workspace.description && <p className={styles.cardDescription}>{workspace.description}</p>}
      {workspace.repoUrl && (
        <div className={styles.cardMeta}>
          {isValidUrl ? (
            <a
              href={workspace.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.repoLink}
            >
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
