import { useState, type FormEvent, type JSX } from "react";
import { useMatch, useSearchParams } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import type { Environment } from "../../hooks/useGrackleSocket.js";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { SETTINGS_URL, newTaskUrl, newChatUrl, useAppNavigate } from "../../utils/navigation.js";
import styles from "./UnifiedBar.module.scss";

// --- Subcomponents ---

/** Returns true when the environment with the given ID is disconnected or in error. */
function isEnvDisconnected(environmentId: string | undefined, environments: Environment[]): boolean {
  if (!environmentId) return false;
  const env = environments.find((e) => e.id === environmentId);
  return env !== undefined && (env.status === "disconnected" || env.status === "error");
}

interface DisconnectedBannerProps {
  environmentId: string;
  onReconnect: (envId: string) => void;
}

/** Hint + Reconnect button shown when the task/session environment is unreachable. */
function DisconnectedBanner({ environmentId, onReconnect }: DisconnectedBannerProps): JSX.Element {
  return (
    <>
      <span className={styles.disconnectHint} data-testid="env-disconnect-hint">
        Environment unavailable
      </span>
      <button
        type="button"
        onClick={() => onReconnect(environmentId)}
        className={styles.btnGhost}
        data-testid="reconnect-btn"
        title="Reconnect the environment to resume messaging"
      >
        Reconnect
      </button>
    </>
  );
}

// --- Main component ---

/** Contextual action bar that adapts to the current route and session/task state. */
export function UnifiedBar(): JSX.Element {
  const {
    spawn, sendInput, kill, sessions, tasks, environments, personas,
    addEnvironment, provisionEnvironment, startTask, taskSessions,
    codespaces, codespaceError, codespaceListError, codespaceCreating, listCodespaces, createCodespace,
  } = useGrackle();
  const { showToast } = useToast();
  const navigate = useAppNavigate();
  const [searchParams] = useSearchParams();

  // Match current route (both global and workspace-scoped task URLs)
  const sessionMatch = useMatch("/sessions/:sessionId");
  const taskMatch = useMatch("/tasks/:taskId");
  const taskStreamMatch = useMatch("/tasks/:taskId/stream");
  const taskFindingsMatch = useMatch("/tasks/:taskId/findings");
  const taskEditMatch = useMatch("/tasks/:taskId/edit");
  const wsTaskMatch = useMatch("/workspaces/:workspaceId/tasks/:taskId");
  const wsTaskStreamMatch = useMatch("/workspaces/:workspaceId/tasks/:taskId/stream");
  const wsTaskFindingsMatch = useMatch("/workspaces/:workspaceId/tasks/:taskId/findings");
  const wsTaskEditMatch = useMatch("/workspaces/:workspaceId/tasks/:taskId/edit");
  const newChatMatch = useMatch("/sessions/new");
  const newEnvMatch = useMatch("/environments/new");
  const workspaceMatch = useMatch("/workspaces/:workspaceId");
  const newTaskMatch = useMatch("/tasks/new");
  const chatMatch = useMatch("/chat");
  const emptyMatch = useMatch("/");
  const settingsMatch = useMatch("/settings/*");

  // Derive current page context
  const sessionId = sessionMatch?.params.sessionId;
  const taskId = taskMatch?.params.taskId ?? taskStreamMatch?.params.taskId ?? taskFindingsMatch?.params.taskId
    ?? wsTaskMatch?.params.taskId ?? wsTaskStreamMatch?.params.taskId ?? wsTaskFindingsMatch?.params.taskId;
  const isChat = !!chatMatch;
  const isNewChat = !!newChatMatch;
  const isNewEnv = !!newEnvMatch;
  const isWorkspace = !!workspaceMatch && !wsTaskMatch && !wsTaskStreamMatch && !wsTaskFindingsMatch && !wsTaskEditMatch;
  const isNewTask = !!newTaskMatch;
  const isTaskEdit = !!taskEditMatch || !!wsTaskEditMatch;
  const isEmpty = !!emptyMatch && !isNewChat && !isNewEnv && !isWorkspace && !isNewTask;
  const isSettings = !!settingsMatch;

  // New chat params
  const newChatEnvId = isNewChat ? (searchParams.get("env") ?? "") : "";

  const [text, setText] = useState("");
  const [spawnPersonaId, setSpawnPersonaId] = useState("");

  // ─── New environment form state ─────────────────
  const [envName, setEnvName] = useState("");
  const [envAdapterType, setEnvAdapterType] = useState("local");
  const [envHost, setEnvHost] = useState("");
  const [envPort, setEnvPort] = useState("");
  const [envUser, setEnvUser] = useState("");
  const [envImage, setEnvImage] = useState("");
  const [envRepo, setEnvRepo] = useState("");
  const [envCodespaceName, setEnvCodespaceName] = useState("");
  const [envIdentityFile, setEnvIdentityFile] = useState("");
  const [envCreateRepo, setEnvCreateRepo] = useState("");
  const [envCreateMachine, setEnvCreateMachine] = useState("");
  const [envCodespaceMode, setEnvCodespaceMode] = useState<"pick" | "create">("pick");

  const session = sessionId
    ? sessions.find((s) => s.id === sessionId)
    : undefined;

  // Task context
  const task = taskId
    ? tasks.find((t) => t.id === taskId)
    : undefined;
  const taskSessionId = task?.latestSessionId || undefined;
  const taskSession = taskSessionId
    ? sessions.find((s) => s.id === taskSessionId)
    : undefined;

  // Check if task is blocked
  const isTaskBlocked = task
    ? task.dependsOn.some((depId) => {
      const dep = tasks.find((t) => t.id === depId);
      return dep && dep.status !== "complete";
    })
    : false;

  // --- chat mode (root task) ---
  if (isChat) {
    const rootTask = tasks.find((t) => t.id === ROOT_TASK_ID);
    // Resolve latest session from the already-loaded sessions list first (available
    // immediately on connect), falling back to taskSessions (requires roundtrip).
    const latestRootSession = rootTask?.latestSessionId
      ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
         (taskSessions[ROOT_TASK_ID] ?? []).find((s) => s.id === rootTask.latestSessionId))
      : undefined;
    const localEnv = environments.find((e) => e.adapterType === "local" && e.status === "connected");

    if (!localEnv) {
      return (
        <div className={styles.bar}>
          <span className={styles.hintText}>
            Add a local environment to start chatting
          </span>
        </div>
      );
    }

    if (latestRootSession?.status === "running") {
      return (
        <div className={styles.bar}>
          <input type="text" disabled placeholder="Agent is working..." className={styles.input} />
          <button onClick={() => kill(latestRootSession.id)} className={styles.btnDanger} title="Stop session">Stop</button>
        </div>
      );
    }

    if (latestRootSession?.status === "idle") {
      const rootEnvDisconnected = isEnvDisconnected(latestRootSession.environmentId, environments);
      const handleChatSend = (e: FormEvent): void => {
        e.preventDefault();
        if (!text.trim() || rootEnvDisconnected) {
          return;
        }
        sendInput(latestRootSession.id, text);
        setText("");
      };
      return (
        <form onSubmit={handleChatSend} className={styles.bar}>
          {rootEnvDisconnected && latestRootSession.environmentId && (
            <DisconnectedBanner environmentId={latestRootSession.environmentId} onReconnect={provisionEnvironment} />
          )}
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus={!rootEnvDisconnected} disabled={rootEnvDisconnected} className={styles.input} />
          <span title={rootEnvDisconnected ? "Environment is unavailable — reconnect first" : undefined}>
            <button type="submit" disabled={!text.trim() || rootEnvDisconnected} className={styles.btnPrimary}>Send</button>
          </span>
          <button type="button" onClick={() => kill(latestRootSession.id)} className={styles.btnDanger} title="Stop session">Stop</button>
        </form>
      );
    }

    // No active session — show input to start one
    const handleChatStart = (e: FormEvent): void => {
      e.preventDefault();
      if (!text.trim()) {
        return;
      }
      startTask(ROOT_TASK_ID, undefined, localEnv.id, text);
      setText("");
    };
    return (
      <form onSubmit={handleChatStart} className={styles.bar}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus className={styles.input} />
        <button type="submit" disabled={!text.trim()} className={styles.btnPrimary}>Send</button>
      </form>
    );
  }

  // --- dashboard / settings mode ---
  if (isEmpty || isSettings) {
    return <></>;
  }

  // --- edit_task / new_task mode — form is in main panel, bar is hidden ---
  if (isTaskEdit || isNewTask) {
    return <></>;
  }

  // --- new_environment mode ---
  if (isNewEnv) {
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
      addEnvironment(envName.trim(), envAdapterType, config);
      showToast("Environment added successfully", "success");
      setEnvName("");
      setEnvAdapterType("local");
      setEnvHost("");
      setEnvPort("");
      setEnvUser("");
      setEnvImage("");
      setEnvRepo("");
      setEnvCodespaceName("");
      setEnvIdentityFile("");
      setEnvCreateRepo("");
      setEnvCreateMachine("");
      setEnvCodespaceMode("pick");
      navigate(SETTINGS_URL, { replace: true });
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
              <input type="text" value={envHost} onChange={(e) => setEnvHost(e.target.value)} placeholder="Host (optional)..." className={styles.inputSmall} />
              <input type="number" min={1} max={65535} value={envPort} onChange={(e) => setEnvPort(e.target.value)} placeholder="Port (optional)..." className={styles.inputSmall} />
            </>
          )}
          {envAdapterType === "ssh" && (
            <>
              <input type="text" value={envHost} onChange={(e) => setEnvHost(e.target.value)} placeholder="Host (required)..." className={styles.inputSmall} />
              <input type="text" value={envUser} onChange={(e) => setEnvUser(e.target.value)} placeholder="User (optional)..." className={styles.inputSmall} />
              <input type="number" min={1} max={65535} value={envPort} onChange={(e) => setEnvPort(e.target.value)} placeholder="SSH port (optional)..." className={styles.inputSmall} />
              <input type="text" value={envIdentityFile} onChange={(e) => setEnvIdentityFile(e.target.value)} placeholder="Identity file (optional)..." className={styles.inputSmall} />
            </>
          )}
          {envAdapterType === "docker" && (
            <>
              <input type="text" value={envImage} onChange={(e) => setEnvImage(e.target.value)} placeholder="Image (optional)..." className={styles.inputSmall} />
              <input type="text" value={envRepo} onChange={(e) => setEnvRepo(e.target.value)} placeholder="Repo (optional)..." className={styles.inputSmall} />
            </>
          )}
          {envAdapterType === "codespace" && envCodespaceMode === "pick" && (
            <>
              {!codespaceListError && (
                <select
                  value={envCodespaceName}
                  onChange={(e) => {
                    if (e.target.value === "__create__") {
                      setEnvCodespaceMode("create");
                      setEnvCodespaceName("");
                    } else {
                      setEnvCodespaceName(e.target.value);
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
              )}
              {codespaceCreating && (
                <span className={styles.creatingHint}>Creating codespace...</span>
              )}
              {codespaceListError && (
                <>
                  <span className={styles.errorHint}>{codespaceListError}</span>
                  <input
                    type="text"
                    value={envCodespaceName}
                    onChange={(e) => setEnvCodespaceName(e.target.value)}
                    placeholder="Or enter codespace name manually..."
                    className={styles.inputSmall}
                  />
                </>
              )}
              {codespaceError && !codespaceListError && (
                <span className={styles.errorHint}>{codespaceError}</span>
              )}
            </>
          )}
          {envAdapterType === "codespace" && envCodespaceMode === "create" && (
            <>
              <input type="text" value={envCreateRepo} onChange={(e) => setEnvCreateRepo(e.target.value)} placeholder="owner/repo" className={styles.inputSmall} />
              <input type="text" value={envCreateMachine} onChange={(e) => setEnvCreateMachine(e.target.value)} placeholder="Machine type (optional)..." className={styles.inputSmall} />
              <button
                onClick={() => {
                  if (envCreateRepo.trim()) {
                    createCodespace(
                      envCreateRepo.trim(),
                      envCreateMachine.trim() || undefined,
                    );
                    setEnvCodespaceMode("pick");
                    setEnvCreateRepo("");
                    setEnvCreateMachine("");
                  }
                }}
                disabled={!envCreateRepo.trim()}
                className={styles.btnPrimary}
              >
                Create
              </button>
              <button
                onClick={() => { setEnvCodespaceMode("pick"); setEnvCreateRepo(""); setEnvCreateMachine(""); }}
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

  // --- workspace mode (no specific task) ---
  if (isWorkspace) {
    return (
      <div className={styles.bar}>
        <span className={styles.hintText}>
          Select a task or click + to create one
        </span>
      </div>
    );
  }

  // --- task modes ---
  if (taskId && task) {
    // Not started (blocked or unblocked)
    if (task.status === "not_started") {
      const blockerNames = isTaskBlocked
        ? task.dependsOn
          .map((depId) => tasks.find((t) => t.id === depId))
          .filter((t) => t && t.status !== "complete")
          .map((t) => t!.title)
        : [];
      return (
        <div className={styles.bar}>
          {isTaskBlocked ? (
            <span className={styles.statusBlocked}>
              Blocked by: {blockerNames.join(", ")}
            </span>
          ) : (
            <span className={styles.hintText}>Use the buttons above to start or manage this task</span>
          )}
        </div>
      );
    }

    // Working / paused — show chat input when session is idle, "agent working" otherwise
    if (task.status === "working" || task.status === "paused") {
      const isWaiting = taskSession?.status === "idle";

      if (isWaiting) {
        const effectiveEnvId = taskSession.environmentId;
        const taskEnvDisconnected = isEnvDisconnected(effectiveEnvId, environments);

        const handleSend = (e: FormEvent): void => {
          e.preventDefault();
          const effectiveSessionId = task.latestSessionId || taskSessionId;
          if (!text.trim() || !effectiveSessionId || taskEnvDisconnected) {
            return;
          }
          sendInput(effectiveSessionId, text);
          setText("");
        };
        return (
          <form onSubmit={handleSend} className={styles.bar}>
            {taskEnvDisconnected && effectiveEnvId && (
              <DisconnectedBanner environmentId={effectiveEnvId} onReconnect={provisionEnvironment} />
            )}
            <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus={!taskEnvDisconnected} disabled={taskEnvDisconnected} className={styles.input} />
            <span title={taskEnvDisconnected ? "Environment is unavailable — reconnect first" : undefined}>
              <button type="submit" disabled={!text.trim() || taskEnvDisconnected} className={styles.btnPrimary}>Send</button>
            </span>
          </form>
        );
      }

      return (
        <div className={styles.bar}>
          <input type="text" disabled placeholder="Agent is working..." className={styles.input} />
        </div>
      );
    }

    // Complete — keep "+ New Task" as a navigation shortcut
    if (task.status === "complete") {
      return (
        <div className={styles.bar}>
          <span className={`${styles.statusText} ${styles.statusCompleted}`}>
            Task completed
          </span>
          <button
            onClick={() => navigate(newTaskUrl(task.workspaceId))}
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
        </div>
      );
    }
  }

  // --- new_chat mode ---
  if (isNewChat) {
    const handleSpawn = (e: FormEvent): void => {
      e.preventDefault();
      if (!text.trim() || !newChatEnvId) {
        return;
      }
      spawn(newChatEnvId, text, spawnPersonaId);
      showToast("Session started", "success");
      setText("");
      setSpawnPersonaId("");
    };

    return (
      <form onSubmit={handleSpawn} className={styles.bar}>
        <span className={styles.badge}>
          new chat
        </span>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter prompt..." autoFocus className={styles.input} />
        <select value={spawnPersonaId} onChange={(e) => setSpawnPersonaId(e.target.value)} className={styles.select}>
          <option value="">(Default)</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" disabled={!text.trim() || !newChatEnvId} className={styles.btnPrimary}>Go</button>
      </form>
    );
  }

  // --- session mode ---
  if (sessionId) {
    const isRunning = session?.status === "running";
    const isWaiting = session?.status === "idle";
    const isEnded = session !== undefined && ["completed", "failed", "interrupted"].includes(session.status);

    if (isRunning) {
      return (
        <div className={styles.bar}>
          <input type="text" disabled placeholder="Agent is working..." className={styles.input} />
          <button onClick={() => kill(sessionId)} className={styles.btnDanger} title="Stop session">Stop</button>
        </div>
      );
    }

    if (isWaiting) {
      const sessionEnvDisconnected = isEnvDisconnected(session.environmentId, environments);

      const handleSend = (e: FormEvent): void => {
        e.preventDefault();
        if (!text.trim() || sessionEnvDisconnected) {
          return;
        }
        sendInput(sessionId, text);
        setText("");
      };
      return (
        <form onSubmit={handleSend} className={styles.bar}>
          {sessionEnvDisconnected && session.environmentId && (
            <DisconnectedBanner environmentId={session.environmentId} onReconnect={provisionEnvironment} />
          )}
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." autoFocus={!sessionEnvDisconnected} disabled={sessionEnvDisconnected} className={styles.input} />
          <span title={sessionEnvDisconnected ? "Environment is unavailable — reconnect first" : undefined}>
            <button type="submit" disabled={!text.trim() || sessionEnvDisconnected} className={styles.btnPrimary}>Send</button>
          </span>
          <button type="button" onClick={() => kill(sessionId)} className={styles.btnDanger} title="Stop session">Stop</button>
        </form>
      );
    }

    if (isEnded) {
      return (
        <div className={styles.bar}>
          <span className={`${styles.statusText} ${styles.hintText}`}>Session {session.status}</span>
          <button onClick={() => navigate(newChatUrl(session.environmentId))} className={styles.btnPrimary}>
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
