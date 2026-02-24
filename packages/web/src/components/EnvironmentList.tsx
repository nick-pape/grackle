import { useGrackle } from "../context/GrackleContext.js";
import type { ViewMode } from "../App.js";
import type { Environment, Session } from "../hooks/useGrackleSocket.js";

interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

const STATUS_COLORS: Record<string, string> = {
  connected: "#4ecca3",
  sleeping: "#f0c040",
  error: "#e94560",
  disconnected: "#666",
  connecting: "#70a1ff",
};

// --- Subcomponents ---

function SessionStatusDot({ status }: { status: string }) {
  const color =
    status === "running" ? "#4ecca3" :
    status === "waiting_input" ? "#f0c040" :
    status === "completed" ? "#888" :
    status === "failed" ? "#e94560" :
    status === "killed" ? "#e94560" :
    "#666";
  return <span style={{ color, fontSize: "8px" }}>●</span>;
}

interface EnvironmentCardProps {
  env: Environment;
  envSessions: Session[];
  selectedSessionId: string | null;
  isNewChatTarget: boolean;
  setViewMode: (mode: ViewMode) => void;
}

function EnvironmentCard({
  env,
  envSessions,
  selectedSessionId,
  isNewChatTarget,
  setViewMode,
}: EnvironmentCardProps) {
  const statusColor = STATUS_COLORS[env.status] || "#666";
  const isConnected = env.status === "connected";

  return (
    <div>
      <div
        style={{
          padding: "6px 12px",
          fontSize: "13px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: isNewChatTarget ? "#0f3460" : "transparent",
        }}
      >
        <span style={{ color: statusColor }}>●</span>
        <span>{env.displayName || env.id}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
          {envSessions.length === 0 && !isNewChatTarget && (
            <span style={{ fontSize: "11px", color: "#666" }}>(idle)</span>
          )}
          {isConnected && (
            <button
              onClick={() => setViewMode({ kind: "new_chat", environmentId: env.id, runtime: env.defaultRuntime || "claude-code" })}
              title="New chat"
              style={{
                background: "none",
                border: "1px solid #4ecca3",
                color: "#4ecca3",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "12px",
                lineHeight: "1",
                padding: "1px 5px",
                fontFamily: "monospace",
              }}
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
          style={{
            padding: "4px 12px 4px 28px",
            fontSize: "12px",
            cursor: "pointer",
            background: selectedSessionId === session.id ? "#0f3460" : "transparent",
            color: selectedSessionId === session.id ? "#e0e0e0" : "#a0a0a0",
          }}
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

export function EnvironmentList({ viewMode, setViewMode }: Props) {
  const { environments, sessions } = useGrackle();

  const selectedSessionId = viewMode.kind === "session" ? viewMode.sessionId : null;
  const newChatEnvId = viewMode.kind === "new_chat" ? viewMode.environmentId : null;

  return (
    <div
      style={{
        width: "240px",
        minWidth: "240px",
        borderRight: "1px solid #0f3460",
        overflowY: "auto",
        padding: "8px 0",
        background: "#16213e",
      }}
    >
      <div style={{ padding: "4px 12px", fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>
        Environments
      </div>

      {environments.length === 0 && (
        <div style={{ padding: "12px", color: "#666", fontSize: "12px" }}>
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
