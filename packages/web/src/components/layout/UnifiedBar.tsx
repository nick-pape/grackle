import { useState, type FormEvent, type JSX } from "react";
import { useMatch, useSearchParams } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { useToast } from "../../context/ToastContext.js";
import type { Environment } from "../../hooks/useGrackleSocket.js";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { newTaskUrl, newChatUrl, useAppNavigate } from "../../utils/navigation.js";
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
    provisionEnvironment, taskSessions,
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
  const envEditMatch = useMatch("/environments/:environmentId");
  const workspaceMatch = useMatch("/workspaces/:workspaceId");
  const newTaskMatch = useMatch("/tasks/new");
  const chatMatch = useMatch("/chat");
  const emptyMatch = useMatch("/");
  const settingsMatch = useMatch("/settings/*");

  // Derive current page context
  const sessionId = sessionMatch?.params.sessionId;
  const taskId = taskMatch?.params.taskId ?? taskStreamMatch?.params.taskId ?? taskFindingsMatch?.params.taskId
    ?? wsTaskMatch?.params.taskId ?? wsTaskStreamMatch?.params.taskId ?? wsTaskFindingsMatch?.params.taskId ?? wsTaskEditMatch?.params.taskId;
  const isChat = !!chatMatch;
  const isNewChat = !!newChatMatch;
  const isNewEnv = !!newEnvMatch;
  const isEnvEdit = !!envEditMatch && !isNewEnv;
  const isWorkspace = !!workspaceMatch && !wsTaskMatch && !wsTaskStreamMatch && !wsTaskFindingsMatch && !wsTaskEditMatch;
  const isNewTask = !!newTaskMatch;
  const isTaskEdit = !!taskEditMatch || !!wsTaskEditMatch;
  const isEmpty = !!emptyMatch && !isNewChat && !isNewEnv && !isWorkspace && !isNewTask;
  const isSettings = !!settingsMatch;

  // New chat params
  const newChatEnvId = isNewChat ? (searchParams.get("env") ?? "") : "";

  const [text, setText] = useState("");
  const [spawnPersonaId, setSpawnPersonaId] = useState("");

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

  if (isChat) {
    const rootTask = tasks.find((t) => t.id === ROOT_TASK_ID);
    const latestRootSession = rootTask?.latestSessionId
      ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
         (taskSessions[ROOT_TASK_ID] ?? []).find((s) => s.id === rootTask.latestSessionId))
      : undefined;
    const localEnv = environments.find((e) => e.adapterType === "local" && e.status === "connected");

    if (!localEnv) {
      return (
        <div className={styles.bar}>
          <span className={styles.hintText}>Add a local environment to start chatting</span>
        </div>
      );
    }

    // Active session (running or idle) — show chat input with sendInput
    if (latestRootSession && !["completed", "failed", "interrupted", "hibernating"].includes(latestRootSession.status)) {
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

    // No active session — server auto-starts the root task when an environment connects.
    return (
      <div className={styles.bar}>
        <span className={styles.hintText}>Starting system agent...</span>
      </div>
    );
  }

  // --- dashboard / settings mode ---
  if (isEmpty || isSettings) {
    return <></>;
  }

  // --- edit_task / new_task / new_env / edit_env — form is in main panel, bar is hidden ---
  if (isTaskEdit || isNewTask || isNewEnv || isEnvEdit) {
    return <></>;
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

    // Working / paused — show chat input + Stop when session is active
    if (task.status === "working" || task.status === "paused") {
      const isActive = taskSession && !["completed", "failed", "interrupted", "hibernating"].includes(taskSession.status);

      if (isActive) {
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
          <span className={styles.hintText}>Waiting for agent...</span>
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
    const isEnded = session !== undefined && ["completed", "failed", "interrupted", "hibernating"].includes(session.status);
    const isActive = session !== undefined && !isEnded;

    if (isActive) {
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
