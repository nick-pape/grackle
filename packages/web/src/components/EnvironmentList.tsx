import { useGrackle } from "../context/GrackleContext.js";

interface Props {
  selectedSession: string | null;
  onSelectSession: (id: string | null) => void;
}

const STATUS_COLORS: Record<string, string> = {
  connected: "#4ecca3",
  sleeping: "#f0c040",
  error: "#e94560",
  disconnected: "#666",
  connecting: "#70a1ff",
};

export function EnvironmentList({ selectedSession, onSelectSession }: Props) {
  const { environments, sessions } = useGrackle();

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
        const envSessions = sessions.filter((s) => s.envId === env.id);
        const statusColor = STATUS_COLORS[env.status] || "#666";

        return (
          <div key={env.id}>
            <div
              style={{
                padding: "6px 12px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: statusColor }}>●</span>
              <span>{env.displayName || env.id}</span>
              {envSessions.length === 0 && (
                <span style={{ fontSize: "11px", color: "#666", marginLeft: "auto" }}>(idle)</span>
              )}
            </div>

            {envSessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                style={{
                  padding: "4px 12px 4px 28px",
                  fontSize: "12px",
                  cursor: "pointer",
                  background: selectedSession === session.id ? "#0f3460" : "transparent",
                  color: selectedSession === session.id ? "#e0e0e0" : "#a0a0a0",
                }}
              >
                <SessionStatusDot status={session.status} />
                {" "}
                {session.prompt.length > 24 ? session.prompt.slice(0, 24) + "..." : session.prompt}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

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
