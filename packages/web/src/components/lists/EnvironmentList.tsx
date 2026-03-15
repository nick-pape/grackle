import { useState, type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import type { Environment, ProvisionStatus, Session } from "../../hooks/useGrackleSocket.js";
import { ConfirmDialog } from "../display/index.js";
import { sessionUrl, newChatUrl, NEW_ENVIRONMENT_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./EnvironmentList.module.scss";

/** Environment status colors using CSS custom properties. */
const STATUS_COLORS: Record<string, string> = {
  connected: "var(--accent-green)",
  sleeping: "var(--accent-yellow)",
  error: "var(--accent-red)",
  disconnected: "var(--text-tertiary)",
  connecting: "var(--accent-blue)",
};

/** Human-readable labels for session statuses. */
const SESSION_STATUS_LABELS: Record<string, string> = {
  running: "running",
  idle: "awaiting input",
  failed: "failed",
  interrupted: "interrupted",
  completed: "completed",
};

/** Display order for session status groups in the summary. */
const SESSION_STATUS_ORDER: string[] = ["running", "idle", "failed", "interrupted", "completed"];

/** Duration in seconds for the session accordion animation. */
const SESSION_ACCORDION_DURATION: number = 0.2;

/** Build a compact summary string like "3 running, 1 awaiting input". */
function buildSessionSummary(sessions: Session[]): string {
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    counts[session.status] = (counts[session.status] || 0) + 1;
  }
  const knownParts = SESSION_STATUS_ORDER
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${SESSION_STATUS_LABELS[status] || status}`);

  const knownSet = new Set(SESSION_STATUS_ORDER);
  const unknownParts = Object.keys(counts)
    .filter((status) => !knownSet.has(status))
    .sort()
    .map((status) => `${counts[status]} ${status}`);

  return [...knownParts, ...unknownParts].join(", ");
}

// --- Subcomponents ---

/** Colored dot indicating session status. */
function SessionStatusDot({ status }: { status: string }): JSX.Element {
  const color =
    status === "running" ? "var(--accent-green)" :
    status === "idle" ? "var(--accent-yellow)" :
    status === "completed" ? "var(--text-secondary)" :
    status === "failed" ? "var(--accent-red)" :
    status === "interrupted" ? "var(--accent-red)" :
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
  sessionsExpanded: boolean;
  onToggleSessionsExpand: () => void;
  provisionProgress: ProvisionStatus | undefined;
  onProvision: (environmentId: string) => void;
  onStop: (environmentId: string) => void;
  onRemove: (environmentId: string) => void;
  navigate: ReturnType<typeof useAppNavigate>;
}

/** Card displaying an environment with its sessions and lifecycle actions. */
function EnvironmentCard({
  env,
  envSessions,
  selectedSessionId,
  isNewChatTarget,
  expanded,
  onToggleExpand,
  sessionsExpanded,
  onToggleSessionsExpand,
  provisionProgress,
  onProvision,
  onStop,
  onRemove,
  navigate,
}: EnvironmentCardProps): JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const statusColor = STATUS_COLORS[env.status] || "var(--text-tertiary)";
  const isConnected = env.status === "connected";
  const isConnecting = env.status === "connecting";
  const isDisconnected = env.status === "disconnected" || env.status === "error";

  return (
    <div>
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Environment?"
        description={`"${env.displayName || env.id}" will be permanently removed. This destroys the workspace and removes all data.`}
        onConfirm={() => { onRemove(env.id); setShowDeleteConfirm(false); }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <div
        className={`${styles.envRow} ${isNewChatTarget ? styles.targeted : ""} ${expanded ? styles.expanded : ""}`}
        data-testid="env-row"
        onClick={onToggleExpand}
      >
        <span
          className={`${styles.statusDot} ${isConnected ? styles.pulse : ""}`}
          style={{ color: statusColor }}
        >
          {"\u25CF"}
        </span>
        <span className={styles.envName} title={env.displayName || env.id}>{env.displayName || env.id}</span>
        <span className={styles.envActions}>
          {envSessions.length === 0 && !isNewChatTarget && !expanded && (
            <span className={styles.idleLabel}>(idle)</span>
          )}
          {isConnected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(newChatUrl(env.id, env.defaultRuntime || "claude-code"));
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
                setShowDeleteConfirm(true);
              }}
              className={styles.deleteButton}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {envSessions.length > 0 && (
        <>
          <div
            className={styles.sessionSummaryRow}
            data-testid="session-summary-row"
            role="button"
            tabIndex={0}
            aria-expanded={sessionsExpanded}
            aria-label={sessionsExpanded ? "Collapse sessions" : "Expand sessions"}
            onClick={onToggleSessionsExpand}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleSessionsExpand(); } }}
          >
            <span className={`${styles.sessionExpandArrow} ${sessionsExpanded ? styles.expanded : ""}`}>
              {"\u25B8"}
            </span>
            <span className={styles.sessionSummaryText}>
              {buildSessionSummary(envSessions)}
            </span>
            <span className={styles.sessionCountBadge}>{envSessions.length}</span>
          </div>
          <AnimatePresence>
            {sessionsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: SESSION_ACCORDION_DURATION, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                {envSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(sessionUrl(session.id));
                    }}
                    className={`${styles.sessionRow} ${selectedSessionId === session.id ? styles.selected : ""}`}
                    title={session.prompt}
                    data-testid="session-row"
                  >
                    <SessionStatusDot status={session.status} />
                    {" "}
                    {session.prompt.length > 24 ? session.prompt.slice(0, 24) + "..." : session.prompt}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

// --- Main component ---

/** Sidebar panel listing all environments and their active sessions. */
export function EnvironmentList(): JSX.Element {
  const {
    environments,
    sessions,
    provisionStatus,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
  } = useGrackle();
  const navigate = useAppNavigate();
  // eslint-disable-next-line @rushstack/no-new-null
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());

  // Derive selected state from router
  const sessionMatch = useMatch("/sessions/:sessionId");
  const newChatMatch = useMatch("/sessions/new");
  const selectedSessionId = sessionMatch?.params.sessionId;
  // For new chat target, we need to check search params
  const newChatEnvId = newChatMatch ? new URLSearchParams(window.location.search).get("env") ?? undefined : undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Environments</span>
        <button
          className={styles.addButton}
          onClick={() => navigate(NEW_ENVIRONMENT_URL)}
          title="Add environment"
        >
          + Add Environment
        </button>
      </div>

      {environments.length === 0 && (
        <div className={styles.emptyCta}>
          <button
            className={styles.ctaButton}
            onClick={() => navigate(NEW_ENVIRONMENT_URL)}
          >
            Add Environment
          </button>
          <div className={styles.ctaDescription}>
            Connect an environment to run agents
          </div>
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
            sessionsExpanded={expandedSessionIds.has(env.id)}
            onToggleSessionsExpand={() => {
              setExpandedSessionIds((prev) => {
                const next = new Set(prev);
                if (next.has(env.id)) {
                  next.delete(env.id);
                } else {
                  next.add(env.id);
                }
                return next;
              });
            }}
            provisionProgress={provisionStatus[env.id]}
            onProvision={provisionEnvironment}
            onStop={stopEnvironment}
            onRemove={removeEnvironment}
            navigate={navigate}
          />
        );
      })}
    </div>
  );
}
