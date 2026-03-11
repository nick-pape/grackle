import { useState, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { ViewMode } from "../../App.js";
import type { Environment, ProvisionStatus, Session } from "../../hooks/useGrackleSocket.js";
import styles from "./EnvironmentList.module.scss";

/** Props for the EnvironmentList component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

/** Environment status colors using CSS custom properties. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

// --- Subcomponents ---

/** Colored dot indicating session status. */
function SessionStatusDot({ status }: { status: string }): JSX.Element {
  const color =
    status === "running" ? "var(--accent-green)" :
    status === "waiting_input" ? "var(--accent-yellow)" :
    status === "completed" ? "var(--text-secondary)" :
    status === "failed" ? "var(--accent-red)" :
    status === "killed" ? "var(--accent-red)" :
    "var(--text-tertiary)";
  return <span className={styles.sessionDot} style={{ color }}>{"\u25CF"}</span>;
}

/** Props for the EnvironmentCard subcomponent. */
interface EnvironmentCardProps {
  env: Environment;
  envSessions: Session[];
  selectedSessionId: string | undefined;
  isNewChatTarget: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  provisionProgress: ProvisionStatus | undefined;
  onProvision: (environmentId: string) => void;
  onStop: (environmentId: string) => void;
  onRemove: (environmentId: string) => void;
  setViewMode: (mode: ViewMode) => void;
}

/** Card displaying an environment with its sessions and lifecycle actions. */
function EnvironmentCard({
  env,
  envSessions,
  selectedSessionId,
  isNewChatTarget,
  expanded,
  onToggleExpand,
  provisionProgress,
  onProvision,
  onStop,
  onRemove,
  setViewMode,
}: EnvironmentCardProps): JSX.Element {
  const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
  const isConnected = env.status === "connected";
  const isConnecting = env.status === "connecting";
  const isDisconnected = env.status === "disconnected" || env.status === "error";

  return (
    <div>
      <div
        className={`${styles.envRow} ${isNewChatTarget ? styles.targeted : ""} ${expanded ? styles.expanded : ""}`}
        onClick={onToggleExpand}
      >
        <span
          className={`${styles.statusDot} ${isConnected ? styles.pulse : ""}`}
          style={{ color: statusColor }}
        >
          {"\u25CF"}
        </span>
        <span className={styles.envName}>{env.displayName || env.id}</span>
        <span className={styles.envActions}>
          {envSessions.length === 0 && !isNewChatTarget && !expanded && (
            <span className={styles.idleLabel}>(idle)</span>
          )}
          {isConnected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setViewMode({ kind: "new_chat", environmentId: env.id, runtime: env.defaultRuntime || "claude-code" });
              }}
              title="New chat"
              className={styles.newChatButton}
            >
              +
            </button>
          )}
        </span>
      </div>

      {/* Expandable action row */}
      {expanded && (
        <div className={styles.envActionsRow}>
          {isConnecting && provisionProgress && (
            <span className={styles.provisionMessage}>
              {provisionProgress.message}
            </span>
          )}
          {env.status === "error" && provisionProgress?.stage === "error" && (
            <span className={styles.errorMessage}>{provisionProgress.message}</span>
          )}
          {isDisconnected && (
            <button
              onClick={(e) => { e.stopPropagation(); onProvision(env.id); }}
              className={styles.connectButton}
            >
              {env.status === "error" ? "Retry" : "Connect"}
            </button>
          )}
          {isConnected && (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(env.id); }}
              className={styles.stopButton}
            >
              Stop
            </button>
          )}
          {!isConnecting && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete environment "${env.displayName || env.id}"? This destroys the workspace and removes all data.`)) {
                  onRemove(env.id);
                }
              }}
              className={styles.deleteButton}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {envSessions.map((session) => (
        <div
          key={session.id}
          onClick={() => setViewMode({ kind: "session", sessionId: session.id })}
          className={`${styles.sessionRow} ${selectedSessionId === session.id ? styles.selected : ""}`}
        >
          <SessionStatusDot status={session.status} />
          {" "}
          {session.prompt.length > 24 ? session.prompt.slice(0, 24) + "..." : session.prompt}
        </div>
      ))}
    </div>
  );
}

// --- Main component ---

/** Sidebar panel listing all environments and their active sessions. */
export function EnvironmentList({ viewMode, setViewMode }: Props): JSX.Element {
  const {
    environments,
    sessions,
    provisionStatus,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
  } = useGrackle();
  // eslint-disable-next-line @rushstack/no-new-null
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectedSessionId = viewMode.kind === "session" ? viewMode.sessionId : undefined;
  const newChatEnvId = viewMode.kind === "new_chat" ? viewMode.environmentId : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        Environments
        <button
          className={styles.addButton}
          onClick={() => setViewMode({ kind: "new_environment" })}
          title="Add environment"
          aria-label="Add environment"
        >
          +
        </button>
      </div>

      {environments.length === 0 && (
        <div className={styles.emptyState}>
          No environments. Click + to add one.
        </div>
      )}

      {environments.map((env) => {
        const envSessions = sessions.filter((s) => s.environmentId === env.id);
        return (
          <EnvironmentCard
            key={env.id}
            env={env}
            envSessions={envSessions}
            selectedSessionId={selectedSessionId}
            isNewChatTarget={newChatEnvId === env.id}
            expanded={expandedId === env.id}
            onToggleExpand={() => setExpandedId(expandedId === env.id ? null : env.id)}
            provisionProgress={provisionStatus[env.id]}
            onProvision={provisionEnvironment}
            onStop={stopEnvironment}
            onRemove={removeEnvironment}
            setViewMode={setViewMode}
          />
        );
      })}
    </div>
  );
}
