import { useState, useEffect, type FormEvent } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import type { ViewMode } from "../App.js";

interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

// --- Subcomponents ---

interface RuntimeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

function RuntimeSelector({ value, onChange }: RuntimeSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      <option value="claude-code">claude-code</option>
      <option value="stub">stub</option>
    </select>
  );
}

// --- Main component ---

export function UnifiedBar({ viewMode, setViewMode }: Props) {
  const { spawn, sendInput, kill, sessions } = useGrackle();
  const [text, setText] = useState("");
  const [runtime, setRuntime] = useState(
    viewMode.kind === "new_chat" ? viewMode.runtime : "claude-code"
  );

  useEffect(() => {
    if (viewMode.kind === "new_chat") {
      setRuntime(viewMode.runtime);
    }
  }, [viewMode]);

  const session = viewMode.kind === "session"
    ? sessions.find((s) => s.id === viewMode.sessionId)
    : null;

  const isRunning = session?.status === "running";
  const isWaiting = session?.status === "waiting_input";
  const isEnded = session != null &&
    ["completed", "failed", "killed"].includes(session.status);

  // --- empty mode ---
  if (viewMode.kind === "empty") {
    return (
      <div style={barStyle}>
        <span style={{ color: "#666", fontSize: "13px" }}>
          Select a session or click + to start
        </span>
      </div>
    );
  }

  // --- new_chat mode ---
  if (viewMode.kind === "new_chat") {
    const handleSpawn = (e: FormEvent) => {
      e.preventDefault();
      if (!text.trim()) return;
      spawn(viewMode.envId, text, undefined, runtime);
      setText("");
    };

    return (
      <form onSubmit={handleSpawn} style={barStyle}>
        <span
          style={{
            fontSize: "11px",
            color: "#4ecca3",
            background: "#0f3460",
            padding: "3px 8px",
            borderRadius: "3px",
            whiteSpace: "nowrap",
          }}
        >
          new chat
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter prompt..."
          autoFocus
          style={inputStyle}
        />
        <RuntimeSelector value={runtime} onChange={setRuntime} />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{
            ...btnStyle,
            background: text.trim() ? "#4ecca3" : "#333",
            cursor: text.trim() ? "pointer" : "not-allowed",
          }}
        >
          Go
        </button>
      </form>
    );
  }

  // --- session mode: running ---
  if (isRunning) {
    return (
      <div style={barStyle}>
        <input
          type="text"
          disabled
          placeholder="Agent is working..."
          style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }}
        />
        <button
          onClick={() => kill(viewMode.sessionId)}
          style={stopBtnStyle}
          title="Stop session"
        >
          Stop
        </button>
      </div>
    );
  }

  // --- session mode: waiting_input ---
  if (isWaiting) {
    const handleSend = (e: FormEvent) => {
      e.preventDefault();
      if (!text.trim()) return;
      sendInput(viewMode.sessionId, text);
      setText("");
    };

    return (
      <form onSubmit={handleSend} style={barStyle}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          autoFocus
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{
            ...btnStyle,
            background: text.trim() ? "#4ecca3" : "#333",
            cursor: text.trim() ? "pointer" : "not-allowed",
          }}
        >
          Send
        </button>
        <button
          type="button"
          onClick={() => kill(viewMode.sessionId)}
          style={stopBtnStyle}
          title="Stop session"
        >
          Stop
        </button>
      </form>
    );
  }

  // --- session mode: ended ---
  if (isEnded && session) {
    return (
      <div style={barStyle}>
        <span style={{ color: "#666", fontSize: "13px", flex: 1 }}>
          Session {session.status}
        </span>
        <button
          onClick={() => setViewMode({ kind: "new_chat", envId: session.envId, runtime: session.runtime })}
          style={btnStyle}
        >
          + New Chat
        </button>
      </div>
    );
  }

  // fallback (session still loading)
  return (
    <div style={barStyle}>
      <span style={{ color: "#666", fontSize: "13px" }}>Loading...</span>
    </div>
  );
}

// --- Shared styles ---

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderTop: "1px solid #0f3460",
  background: "#16213e",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "#0f3460",
  border: "1px solid #333",
  color: "#e0e0e0",
  padding: "6px 10px",
  borderRadius: "4px",
  outline: "none",
  fontFamily: "monospace",
  fontSize: "13px",
};

const selectStyle: React.CSSProperties = {
  background: "#0f3460",
  border: "1px solid #333",
  color: "#e0e0e0",
  padding: "6px 8px",
  borderRadius: "4px",
  fontFamily: "monospace",
  fontSize: "12px",
};

const btnStyle: React.CSSProperties = {
  background: "#4ecca3",
  border: "none",
  color: "#1a1a2e",
  padding: "6px 16px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
  fontFamily: "monospace",
  fontSize: "13px",
};

const stopBtnStyle: React.CSSProperties = {
  background: "#e94560",
  border: "none",
  color: "#fff",
  padding: "6px 12px",
  borderRadius: "4px",
  cursor: "pointer",
  fontWeight: "bold",
  fontFamily: "monospace",
  fontSize: "13px",
};
