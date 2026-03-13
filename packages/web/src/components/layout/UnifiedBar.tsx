import { useState, useEffect, type FormEvent, type JSX } from "react";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import { Callout } from "../notifications/index.js";
import type { ViewMode } from "../../App.js";
import { ConfirmDialog, Spinner } from "../display/index.js";
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
      <option value="codex">codex</option>
      <option value="copilot">copilot</option>
      <option value="stub">stub</option>
    </select>
  );
}

// --- Main component ---

/** Contextual action bar that adapts to the current view mode and session/task state. */
export function UnifiedBar({ viewMode, setViewMode }: Props): JSX.Element {
  const {
    spawn, sendInput, kill, sessions, tasks, environments,
    createTask, startTask, approveTask, rejectTask, deleteTask, addEnvironment,
    codespaces, codespaceError, codespaceCreating, listCodespaces, createCodespace,
    taskStartingId,
  } = useGrackle();
  const { showToast } = useToast();

  const [text, setText] = useState("");
  const [runtime, setRuntime] = useState(
    viewMode.kind === "new_chat" ? viewMode.runtime : "claude-code"
  );
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskEnvId, setTaskEnvId] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [showDeleteTaskConfirm, setShowDeleteTaskConfirm] = useState(false);

  // ─── New environment form state ─────────────────
  const [envName, setEnvName] = useState("");
  const [envAdapterType, setEnvAdapterType] = useState("local");
  const [envRuntime, setEnvRuntime] = useState("claude-code");
  const [envHost, setEnvHost] = useState("");
  const [envPort, setEnvPort] = useState("");
  const [envUser, setEnvUser] = useState("");
  const [envImage, setEnvImage] = useState("");
  const [envRepo, setEnvRepo] = useState("");
  const [envCodespaceName, setEnvCodespaceName] = useState("");
  const [envIdentityFile, setEnvIdentityFile] = useState("");
  const [envCreateRepo, setEnvCreateRepo] = useState("");
  const [envCodespaceMode, setEnvCodespaceMode] = useState<"pick" | "create">("pick");

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

  // --- new_environment mode ---
  if (viewMode.kind === "new_environment") {
    /** Returns true if portStr is empty (optional) or a valid integer in [1, 65535]. */
    const isPortValid = (portStr: string): boolean => {
      if (!portStr.trim()) {
        return true;
      }
      const n = Number(portStr);
      return Number.isInteger(n) && n >= 1 && n <= 65535;
    };

    const isEnvValid = (): boolean => {
      if (!envName.trim()) {
        return false;
      }
      if (envAdapterType === "ssh" && !envHost.trim()) {
        return false;
      }
      if (envAdapterType === "codespace" && !envCodespaceName.trim()) {
        return false;
      }
      if ((envAdapterType === "local" || envAdapterType === "ssh") && !isPortValid(envPort)) {
        return false;
      }
      return true;
    };

    const handleAddEnvironment = (): void => {
      if (!isEnvValid()) {
        return;
      }
      const config: Record<string, unknown> = {};
      if (envAdapterType === "local") {
        if (envHost.trim()) {
          config.host = envHost.trim();
        }
        if (envPort.trim()) {
          const n = Number(envPort);
          if (Number.isInteger(n)) {
            config.port = n;
          }
        }
      } else if (envAdapterType === "ssh") {
        config.host = envHost.trim();
        if (envUser.trim()) {
          config.user = envUser.trim();
        }
        if (envPort.trim()) {
          const n = Number(envPort);
          if (Number.isInteger(n)) {
            config.sshPort = n;
          }
        }
        if (envIdentityFile.trim()) {
          config.identityFile = envIdentityFile.trim();
        }
      } else if (envAdapterType === "docker") {
        if (envImage.trim()) {
          config.image = envImage.trim();
        }
        if (envRepo.trim()) {
          config.repo = envRepo.trim();
        }
      } else if (envAdapterType === "codespace") {
        config.codespaceName = envCodespaceName.trim();
      }
      addEnvironment(envName.trim(), envAdapterType, config, envRuntime);
      showToast(`Environment "${envName.trim()}" added`, "success");
      setEnvName("");
      setEnvAdapterType("local");
      setEnvRuntime("claude-code");
      setEnvHost("");
      setEnvPort("");
      setEnvUser("");
      setEnvImage("");
      setEnvRepo("");
      setEnvCodespaceName("");
      setEnvIdentityFile("");
      setEnvCreateRepo("");
      setEnvCodespaceMode("pick");
      setViewMode({ kind: "empty" });
    };

    return (
      <div className={styles.barColumn}>
        <div className={styles.barRow}>
          <span className={styles.badge}>new env</span>
          <input
            type="text"
            value={envName}
            onChange={(e) => setEnvName(e.target.value)}
            placeholder="Environment name..."
            autoFocus
            className={styles.input}
          />
          <select
            value={envAdapterType}
            onChange={(e) => {
              setEnvAdapterType(e.target.value);
              if (e.target.value === "codespace") {
                listCodespaces();
                setEnvCodespaceMode("pick");
                setEnvCodespaceName("");
              }
            }}
            className={styles.select}
          >
            <option value="local">local</option>
            <option value="ssh">ssh</option>
            <option value="docker">docker</option>
            <option value="codespace">codespace</option>
          </select>
          <RuntimeSelector value={envRuntime} onChange={setEnvRuntime} />
          <button
            onClick={handleAddEnvironment}
            disabled={!isEnvValid()}
            className={styles.btnPrimary}
          >
            Add
          </button>
        </div>
        <div className={styles.barRow}>
          {envAdapterType === "local" && (
            <>
              <input
                type="text"
                value={envHost}
                onChange={(e) => setEnvHost(e.target.value)}
                placeholder="Host (optional)..."
                className={styles.inputSmall}
              />
              <input
                type="number"
                min={1}
                max={65535}
                value={envPort}
                onChange={(e) => setEnvPort(e.target.value)}
                placeholder="Port (optional)..."
                className={styles.inputSmall}
              />
            </>
          )}
          {envAdapterType === "ssh" && (
            <>
              <input
                type="text"
                value={envHost}
                onChange={(e) => setEnvHost(e.target.value)}
                placeholder="Host (required)..."
                className={styles.inputSmall}
              />
              <input
                type="text"
                value={envUser}
                onChange={(e) => setEnvUser(e.target.value)}
                placeholder="User (optional)..."
                className={styles.inputSmall}
              />
              <input
                type="number"
                min={1}
                max={65535}
                value={envPort}
                onChange={(e) => setEnvPort(e.target.value)}
                placeholder="SSH port (optional)..."
                className={styles.inputSmall}
              />
              <input
                type="text"
                value={envIdentityFile}
                onChange={(e) => setEnvIdentityFile(e.target.value)}
                placeholder="Identity file (optional)..."
                className={styles.inputSmall}
              />
            </>
          )}
          {envAdapterType === "docker" && (
            <>
              <input
                type="text"
                value={envImage}
                onChange={(e) => setEnvImage(e.target.value)}
                placeholder="Image (optional)..."
                className={styles.inputSmall}
              />
              <input
                type="text"
                value={envRepo}
                onChange={(e) => setEnvRepo(e.target.value)}
                placeholder="Repo (optional)..."
                className={styles.inputSmall}
              />
            </>
          )}
          {envAdapterType === "codespace" && envCodespaceMode === "pick" && (
            <>
              <select
                value={envCodespaceName}
                onChange={(e) => {
                  if (e.target.value === "__create__") {
                    setEnvCodespaceMode("create");
                    setEnvCodespaceName("");
                  } else {
                    setEnvCodespaceName(e.target.value);
                    // Auto-fill environment name from codespace name
                    if (e.target.value && !envName.trim()) {
                      setEnvName(e.target.value);
                    }
                  }
                }}
                disabled={codespaceCreating}
                className={styles.select}
              >
                <option value="">Select a codespace...</option>
                {codespaces.map((cs) => (
                  <option key={cs.name} value={cs.name}>
                    {cs.name} ({cs.repository}) — {cs.state}
                  </option>
                ))}
                <option value="__create__">Create new from repo...</option>
              </select>
              {codespaceCreating && (
                <span className={styles.creatingHint}>Creating codespace...</span>
              )}
              {codespaceError && (
                <span className={styles.errorHint}>{codespaceError}</span>
              )}
            </>
          )}
          {envAdapterType === "codespace" && envCodespaceMode === "create" && (
            <>
              <input
                type="text"
                value={envCreateRepo}
                onChange={(e) => setEnvCreateRepo(e.target.value)}
                placeholder="owner/repo"
                className={styles.inputSmall}
              />
              <button
                onClick={() => {
                  if (envCreateRepo.trim()) {
                    createCodespace(envCreateRepo.trim());
                    setEnvCodespaceMode("pick");
                    setEnvCreateRepo("");
                  }
                }}
                disabled={!envCreateRepo.trim()}
                className={styles.btnPrimary}
              >
                Create
              </button>
              <button
                onClick={() => {
                  setEnvCodespaceMode("pick");
                  setEnvCreateRepo("");
                }}
                className={styles.btnGhost}
              >
                Cancel
              </button>
            </>
          )}
        </div>
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
      createTask(viewMode.projectId, taskTitle.trim(), taskDesc, taskEnvId, undefined, viewMode.parentTaskId);
      showToast(`Task "${taskTitle.trim()}" created`, "success");
      setTaskTitle("");
      setTaskDesc("");
      setTaskEnvId("");
      setViewMode({ kind: "project", projectId: viewMode.projectId });
    };

    return (
      <div className={styles.barColumn}>
        <div className={styles.barRow}>
          <span className={styles.badge}>
            {viewMode.parentTaskId ? "child task" : "new task"}
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
        <textarea
          value={taskDesc}
          onChange={(e) => setTaskDesc(e.target.value)}
          placeholder="Description (optional)..."
          className={styles.textarea}
          rows={3}
        />
      </div>
    );
  }

  // --- task modes ---
  if (viewMode.kind === "task" && task) {
    // Single shared ConfirmDialog for all task states that support deletion.
    const confirmDialog = (
      <ConfirmDialog
        isOpen={showDeleteTaskConfirm}
        title="Delete Task?"
        description={`"${task.title}" will be permanently removed.`}
        onConfirm={() => { deleteTask(task.id); setViewMode({ kind: "project", projectId: task.projectId }); setShowDeleteTaskConfirm(false); }}
        onCancel={() => setShowDeleteTaskConfirm(false)}
      />
    );

    // Pending + blocked
    if (task.status === "pending" && isTaskBlocked) {
      const blockerNames = task.dependsOn
        .map((depId) => tasks.find((t) => t.id === depId))
        .filter((t) => t && t.status !== "done")
        .map((t) => t!.title);
      return (
        <>
          {confirmDialog}
          <div className={styles.barColumn}>
            <Callout variant="warning">
              Blocked by: {blockerNames.join(", ")}
            </Callout>
            <div className={styles.bar}>
              <button
                onClick={() => setShowDeleteTaskConfirm(true)}
              className={styles.btnDanger}
            >
              Delete
            </button>
            </div>
          </div>
        </>
      );
    }

    // Pending + unblocked
    if (task.status === "pending" || task.status === "assigned") {
      const isStarting = taskStartingId === task.id;
      return (
        <>
          {confirmDialog}
          <div className={styles.bar}>
            {isStarting && (
              <span className={styles.creatingHint}>
                <Spinner size="sm" label="Starting task" />
                Starting task…
              </span>
            )}
            <button
              onClick={() => {
                startTask(task.id);
                showToast(`Task "${task.title}" started`, "success");
              }}
              className={styles.btnPrimary}
              disabled={isStarting}
            >
              {isStarting
                ? <span className={styles.btnLoadingContent}><Spinner size="sm" label="Starting" /> Starting…</span>
                : "Start Task"}
            </button>
            <button
              onClick={() => setShowDeleteTaskConfirm(true)}
              className={styles.btnDanger}
            >
              Delete
            </button>
          </div>
        </>
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
            value=""
            readOnly
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
              showToast(`Task "${task.title}" approved`, "success");
            }}
            className={styles.btnPrimary}
          >
            Approve
          </button>
          <button
            onClick={() => {
              rejectTask(task.id, rejectNotes);
              showToast(`Task "${task.title}" rejected`, "warning");
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
        <>
          {confirmDialog}
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
            <button
              onClick={() => setShowDeleteTaskConfirm(true)}
              className={styles.btnDanger}
            >
              Delete
            </button>
          </div>
        </>
      );
    }

    // Failed
    if (task.status === "failed") {
      const isRetrying = taskStartingId === task.id;
      return (
        <>
          {confirmDialog}
          <div className={styles.bar}>
            <span className={`${styles.statusText} ${styles.statusFailed}`}>
              Task failed
            </span>
            {isRetrying && (
              <span className={styles.creatingHint}>
                <Spinner size="sm" label="Starting task" />
                Starting task…
              </span>
            )}
            <button
              onClick={() => {
                startTask(task.id);
                showToast(`Task "${task.title}" retried`, "info");
              }}
              className={styles.btnPrimary}
              disabled={isRetrying}
            >
              {isRetrying
                ? <span className={styles.btnLoadingContent}><Spinner size="sm" label="Starting" /> Starting…</span>
                : "Retry"}
            </button>
            <button
              onClick={() => setShowDeleteTaskConfirm(true)}
              className={styles.btnDanger}
            >
              Delete
            </button>
          </div>
        </>
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
      showToast("Session started", "success");
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
          <input type="text" value="" readOnly disabled placeholder="Agent is working..." className={styles.input} />
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
