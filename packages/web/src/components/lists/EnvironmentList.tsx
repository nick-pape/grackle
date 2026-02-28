import type { JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import type { ViewMode } from "../../App.js";
import type { Environment, Session } from "../../hooks/useGrackleSocket.js";
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
  setViewMode: (mode: ViewMode) => void;
}

/** Card displaying an environment with its sessions. */
function EnvironmentCard({
  env,
  envSessions,
  selectedSessionId,
  isNewChatTarget,
  setViewMode,
}: EnvironmentCardProps): JSX.Element {
  const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
  const isConnected = env.status === "connected";

  return (
    <div>
      <div className={`${styles.envRow} ${isNewChatTarget ? styles.targeted : ""}`}>
        <span
          className={`${styles.statusDot} ${isConnected ? styles.pulse : ""}`}
          style={{ color: statusColor }}
        >
          {"\u25CF"}
        </span>
        <span className={styles.envName}>{env.displayName || env.id}</span>
        <span className={styles.envActions}>
          {envSessions.length === 0 && !isNewChatTarget && (
            <span className={styles.idleLabel}>(idle)</span>
          )}
          {isConnected && (
            <button
              onClick={() => setViewMode({ kind: "new_chat", environmentId: env.id, runtime: env.defaultRuntime || "claude-code" })}
              title="New chat"
              className={styles.newChatButton}
            >
              +
            </button>
          )}
        </span>
      </div>

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
  const { environments, sessions } = useGrackle();

  const selectedSessionId = viewMode.kind === "session" ? viewMode.sessionId : undefined;
  const newChatEnvId = viewMode.kind === "new_chat" ? viewMode.environmentId : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        Environments
      </div>

      {environments.length === 0 && (
        <div className={styles.emptyState}>
          No environments. Use the CLI to add one.
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
            setViewMode={setViewMode}
          />
        );
      })}
    </div>
  );
}
