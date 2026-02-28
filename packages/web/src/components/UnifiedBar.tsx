import { useState, useEffect, type FormEvent, type JSX } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import type { ViewMode } from "../App.js";
import styles from "./UnifiedBar.module.scss";

/** Props for the UnifiedBar component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

// --- Subcomponents ---

/** Props for the RuntimeSelector subcomponent. */
interface RuntimeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

/** Dropdown for selecting the session runtime. */
function RuntimeSelector({ value, onChange }: RuntimeSelectorProps): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={styles.select}
    >
      <option value="claude-code">claude-code</option>
      <option value="stub">stub</option>
    </select>
  );
}

// --- Main component ---

/** Contextual action bar that adapts to the current view mode and session/task state. */
export function UnifiedBar({ viewMode, setViewMode }: Props): JSX.Element {
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
    : undefined;

  // Task context
  const task = viewMode.kind === "task"
    ? tasks.find((t) => t.id === viewMode.taskId)
    : undefined;
  const taskSession = task?.sessionId
    ? sessions.find((s) => s.id === task.sessionId)
    : undefined;

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
      <div className={styles.bar}>
        <span className={styles.hintText}>
          Select a session or click + to start
        </span>
      </div>
    );
  }

  // --- project mode (no specific task) ---
  if (viewMode.kind === "project") {
    return (
      <div className={styles.bar}>
        <span className={styles.hintText}>
          Select a task or click + to create one
        </span>
      </div>
    );
  }

  // --- new_task mode ---
  if (viewMode.kind === "new_task") {
    const handleCreate = (_andStart: boolean): void => {
      if (!taskTitle.trim()) {
        return;
      }
      createTask(viewMode.projectId, taskTitle.trim(), taskDesc, taskEnvId);
      setTaskTitle("");
      setTaskDesc("");
      setTaskEnvId("");
      setViewMode({ kind: "project", projectId: viewMode.projectId });
    };

    return (
      <div className={styles.barColumn}>
        <div className={styles.barRow}>
          <span className={styles.badge}>
            new task
          </span>
          <input
            type="text"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title..."
            autoFocus
            className={styles.input}
          />
          <select
            value={taskEnvId}
            onChange={(e) => setTaskEnvId(e.target.value)}
            className={styles.select}
          >
            <option value="">Default env</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>{env.displayName}</option>
            ))}
          </select>
          <button
            onClick={() => handleCreate(false)}
            disabled={!taskTitle.trim()}
            className={styles.btnPrimary}
          >
            Create
          </button>
        </div>
        <input
          type="text"
          value={taskDesc}
          onChange={(e) => setTaskDesc(e.target.value)}
          placeholder="Description (optional)..."
          className={styles.inputSmall}
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
        <div className={styles.bar}>
          <span className={styles.statusBlocked}>
            Blocked by: {blockerNames.join(", ")}
          </span>
        </div>
      );
    }

    // Pending + unblocked
    if (task.status === "pending" || task.status === "assigned") {
      return (
        <div className={styles.bar}>
          <button
            onClick={() => startTask(task.id)}
            className={styles.btnPrimary}
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
        const handleSend = (e: FormEvent): void => {
          e.preventDefault();
          if (!text.trim() || !task.sessionId) {
            return;
          }
          sendInput(task.sessionId, text);
          setText("");
        };
        return (
          <form onSubmit={handleSend} className={styles.bar}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              autoFocus
              className={styles.input}
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className={styles.btnPrimary}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => task.sessionId && kill(task.sessionId)}
              className={styles.btnDanger}
            >
              Stop
            </button>
          </form>
        );
      }

      return (
        <div className={styles.bar}>
          <input
            type="text"
            disabled
            placeholder="Agent is working..."
            className={styles.input}
          />
          <button
            onClick={() => task.sessionId && kill(task.sessionId)}
            className={styles.btnDanger}
          >
            Stop
          </button>
        </div>
      );
    }

    // Review
    if (task.status === "review") {
      return (
        <div className={styles.bar}>
          <input
            type="text"
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            placeholder="Rejection notes (optional)..."
            className={styles.input}
          />
          <button
            onClick={() => {
              approveTask(task.id);
            }}
            className={styles.btnPrimary}
          >
            Approve
          </button>
          <button
            onClick={() => {
              rejectTask(task.id, rejectNotes);
              setRejectNotes("");
            }}
            className={styles.btnDanger}
          >
            Reject
          </button>
        </div>
      );
    }

    // Done
    if (task.status === "done") {
      return (
        <div className={styles.bar}>
          <span className={`${styles.statusText} ${styles.statusCompleted}`}>
            Task completed
          </span>
          <button
            onClick={() => setViewMode({ kind: "new_task", projectId: task.projectId })}
            className={styles.btnPrimary}
          >
            + New Task
          </button>
        </div>
      );
    }

    // Failed
    if (task.status === "failed") {
      return (
        <div className={styles.bar}>
          <span className={`${styles.statusText} ${styles.statusFailed}`}>
            Task failed
          </span>
          <button
            onClick={() => startTask(task.id)}
            className={styles.btnPrimary}
          >
            Retry
          </button>
        </div>
      );
    }
  }

  // --- new_chat mode ---
  if (viewMode.kind === "new_chat") {
    const handleSpawn = (e: FormEvent): void => {
      e.preventDefault();
      if (!text.trim()) {
        return;
      }
      spawn(viewMode.environmentId, text, undefined, runtime);
      setText("");
    };

    return (
      <form onSubmit={handleSpawn} className={styles.bar}>
        <span className={styles.badge}>
          new chat
        </span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter prompt..."
          autoFocus
          className={styles.input}
        />
        <RuntimeSelector value={runtime} onChange={setRuntime} />
        <button
          type="submit"
          disabled={!text.trim()}
          className={styles.btnPrimary}
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
    const isEnded = session !== undefined && ["completed", "failed", "killed"].includes(session.status);

    if (isRunning) {
      return (
        <div className={styles.bar}>
          <input type="text" disabled placeholder="Agent is working..." className={styles.input} />
          <button onClick={() => kill(viewMode.sessionId)} className={styles.btnDanger} title="Stop session">
            Stop
          </button>
        </div>
      );
    }

    if (isWaiting) {
      const handleSend = (e: FormEvent): void => {
        e.preventDefault();
        if (!text.trim()) {
          return;
        }
        sendInput(viewMode.sessionId, text);
        setText("");
      };
      return (
        <form onSubmit={handleSend} className={styles.bar}>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus className={styles.input} />
          <button type="submit" disabled={!text.trim()} className={styles.btnPrimary}>
            Send
          </button>
          <button type="button" onClick={() => kill(viewMode.sessionId)} className={styles.btnDanger} title="Stop session">
            Stop
          </button>
        </form>
      );
    }

    if (isEnded && session) {
      return (
        <div className={styles.bar}>
          <span className={`${styles.statusText} ${styles.hintText}`}>Session {session.status}</span>
          <button onClick={() => setViewMode({ kind: "new_chat", environmentId: session.environmentId, runtime: session.runtime })} className={styles.btnPrimary}>
            + New Chat
          </button>
        </div>
      );
    }
  }

  // fallback
  return (
    <div className={styles.bar}>
      <span className={styles.hintText}>Loading...</span>
    </div>
  );
}
