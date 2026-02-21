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
  const {
    spawn, sendInput, kill, sessions, tasks, environments,
    createTask, startTask, approveTask, rejectTask,
  } = useGrackle();

  const [text, setText] = useState("");
  const [runtime, setRuntime] = useState(
    viewMode.kind === "new_chat" ? viewMode.runtime : "claude-code"
  );
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskEnvId, setTaskEnvId] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");

  useEffect(() => {
    if (viewMode.kind === "new_chat") {
      setRuntime(viewMode.runtime);
    }
  }, [viewMode]);

  const session = viewMode.kind === "session"
    ? sessions.find((s) => s.id === viewMode.sessionId)
    : null;

  // Task context
  const task = viewMode.kind === "task"
    ? tasks.find((t) => t.id === viewMode.taskId)
    : null;
  const taskSession = task?.sessionId
    ? sessions.find((s) => s.id === task.sessionId)
    : null;

  // Check if task is blocked
  const isTaskBlocked = task
    ? task.dependsOn.some((depId) => {
        const dep = tasks.find((t) => t.id === depId);
        return dep && dep.status !== "done";
      })
    : false;

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

  // --- project mode (no specific task) ---
  if (viewMode.kind === "project") {
    return (
      <div style={barStyle}>
        <span style={{ color: "#666", fontSize: "13px" }}>
          Select a task or click + to create one
        </span>
      </div>
    );
  }

  // --- new_task mode ---
  if (viewMode.kind === "new_task") {
    const handleCreate = (andStart: boolean) => {
      if (!taskTitle.trim()) return;
      createTask(viewMode.projectId, taskTitle.trim(), taskDesc, taskEnvId);
      // TODO: if andStart, we'd need to wait for the task to be created
      // For now, just create it
      setTaskTitle("");
      setTaskDesc("");
      setTaskEnvId("");
      setViewMode({ kind: "project", projectId: viewMode.projectId });
    };

    return (
      <div style={{ ...barStyle, flexDirection: "column", alignItems: "stretch", gap: "6px" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "#4ecca3", background: "#0f3460", padding: "3px 8px", borderRadius: "3px", whiteSpace: "nowrap" }}>
            new task
          </span>
          <input
            type="text"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title..."
            autoFocus
            style={inputStyle}
          />
          <select
            value={taskEnvId}
            onChange={(e) => setTaskEnvId(e.target.value)}
            style={selectStyle}
          >
            <option value="">Default env</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>{env.displayName}</option>
            ))}
          </select>
          <button
            onClick={() => handleCreate(false)}
            disabled={!taskTitle.trim()}
            style={{
              ...btnStyle,
              background: taskTitle.trim() ? "#4ecca3" : "#333",
              cursor: taskTitle.trim() ? "pointer" : "not-allowed",
            }}
          >
            Create
          </button>
        </div>
        <input
          type="text"
          value={taskDesc}
          onChange={(e) => setTaskDesc(e.target.value)}
          placeholder="Description (optional)..."
          style={{ ...inputStyle, fontSize: "11px" }}
        />
      </div>
    );
  }

  // --- task modes ---
  if (viewMode.kind === "task" && task) {
    // Pending + blocked
    if (task.status === "pending" && isTaskBlocked) {
      const blockerNames = task.dependsOn
        .map((depId) => tasks.find((t) => t.id === depId))
        .filter((t) => t && t.status !== "done")
        .map((t) => t!.title);
      return (
        <div style={barStyle}>
          <span style={{ color: "#f0c040", fontSize: "12px" }}>
            Blocked by: {blockerNames.join(", ")}
          </span>
        </div>
      );
    }

    // Pending + unblocked
    if (task.status === "pending" || task.status === "assigned") {
      return (
        <div style={barStyle}>
          <button
            onClick={() => startTask(task.id)}
            style={btnStyle}
          >
            Start Task
          </button>
        </div>
      );
    }

    // In progress
    if (task.status === "in_progress") {
      const isWaiting = taskSession?.status === "waiting_input";

      if (isWaiting) {
        const handleSend = (e: FormEvent) => {
          e.preventDefault();
          if (!text.trim() || !task.sessionId) return;
          sendInput(task.sessionId, text);
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
              style={{ ...btnStyle, background: text.trim() ? "#4ecca3" : "#333", cursor: text.trim() ? "pointer" : "not-allowed" }}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => task.sessionId && kill(task.sessionId)}
              style={stopBtnStyle}
            >
              Stop
            </button>
          </form>
        );
      }

      return (
        <div style={barStyle}>
          <input
            type="text"
            disabled
            placeholder="Agent is working..."
            style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }}
          />
          <button
            onClick={() => task.sessionId && kill(task.sessionId)}
            style={stopBtnStyle}
          >
            Stop
          </button>
        </div>
      );
    }

    // Review
    if (task.status === "review") {
      return (
        <div style={barStyle}>
          <input
            type="text"
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Rejection notes (optional)..."
            style={inputStyle}
          />
          <button
            onClick={() => {
              approveTask(task.id);
            }}
            style={{ ...btnStyle, background: "#4ecca3" }}
          >
            Approve
          </button>
          <button
            onClick={() => {
              rejectTask(task.id, rejectNotes);
              setRejectNotes("");
            }}
            style={stopBtnStyle}
          >
            Reject
          </button>
        </div>
      );
    }

    // Done
    if (task.status === "done") {
      return (
        <div style={barStyle}>
          <span style={{ color: "#4ecca3", fontSize: "13px", flex: 1 }}>
            Task completed
          </span>
          <button
            onClick={() => setViewMode({ kind: "new_task", projectId: task.projectId })}
            style={btnStyle}
          >
            + New Task
          </button>
        </div>
      );
    }

    // Failed
    if (task.status === "failed") {
      return (
        <div style={barStyle}>
          <span style={{ color: "#e94560", fontSize: "13px", flex: 1 }}>
            Task failed
          </span>
          <button
            onClick={() => startTask(task.id)}
            style={btnStyle}
          >
            Retry
          </button>
        </div>
      );
    }
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
        <span style={{ fontSize: "11px", color: "#4ecca3", background: "#0f3460", padding: "3px 8px", borderRadius: "3px", whiteSpace: "nowrap" }}>
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
          style={{ ...btnStyle, background: text.trim() ? "#4ecca3" : "#333", cursor: text.trim() ? "pointer" : "not-allowed" }}
        >
          Go
        </button>
      </form>
    );
  }

  // --- session mode ---
  if (viewMode.kind === "session") {
    const isRunning = session?.status === "running";
    const isWaiting = session?.status === "waiting_input";
    const isEnded = session != null && ["completed", "failed", "killed"].includes(session.status);

    if (isRunning) {
      return (
        <div style={barStyle}>
          <input type="text" disabled placeholder="Agent is working..." style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }} />
          <button onClick={() => kill(viewMode.sessionId)} style={stopBtnStyle} title="Stop session">
            Stop
          </button>
        </div>
      );
    }

    if (isWaiting) {
      const handleSend = (e: FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;
        sendInput(viewMode.sessionId, text);
        setText("");
      };
      return (
        <form onSubmit={handleSend} style={barStyle}>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus style={inputStyle} />
          <button type="submit" disabled={!text.trim()} style={{ ...btnStyle, background: text.trim() ? "#4ecca3" : "#333", cursor: text.trim() ? "pointer" : "not-allowed" }}>
            Send
          </button>
          <button type="button" onClick={() => kill(viewMode.sessionId)} style={stopBtnStyle} title="Stop session">
            Stop
          </button>
        </form>
      );
    }

    if (isEnded && session) {
      return (
        <div style={barStyle}>
          <span style={{ color: "#666", fontSize: "13px", flex: 1 }}>Session {session.status}</span>
          <button onClick={() => setViewMode({ kind: "new_chat", envId: session.envId, runtime: session.runtime })} style={btnStyle}>
            + New Chat
          </button>
        </div>
      );
    }
  }

  // fallback
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
