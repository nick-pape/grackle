import type { JSX } from "react";
import { useLocation, useMatch } from "react-router";
import { useGrackle } from "../../context/GrackleContext.js";
import { newTaskUrl, newChatUrl, useAppNavigate } from "../../utils/navigation.js";
import styles from "./BottomStatusBar.module.scss";

/**
 * Thin, read-only status bar that shows contextual hints based on the current
 * route and application state. Does NOT contain any form inputs or send/spawn
 * actions — those live in {@link ChatInput} on each page.
 *
 * Returns an empty fragment when the current page is showing a ChatInput or
 * when the route has no meaningful hint to display.
 */
export function BottomStatusBar(): JSX.Element {
  const {
    sessions, tasks, environments,
  } = useGrackle();
  const navigate = useAppNavigate();
  const location = useLocation();

  // Match current route (both global and workspace-scoped task URLs)
  const sessionMatch = useMatch("/sessions/:sessionId");
  const taskMatch = useMatch("/tasks/:taskId");
  const taskStreamMatch = useMatch("/tasks/:taskId/stream");
  const taskFindingsMatch = useMatch("/tasks/:taskId/findings");
  const taskEditMatch = useMatch("/tasks/:taskId/edit");
  const wsTaskMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/tasks/:taskId");
  const wsTaskStreamMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/stream");
  const wsTaskFindingsMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/findings");
  const wsTaskEditMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId/tasks/:taskId/edit");
  const newChatMatch = useMatch("/sessions/new");
  const isEnvironments = location.pathname.startsWith("/environments");
  const workspaceMatch = useMatch("/environments/:environmentId/workspaces/:workspaceId");
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
  const isWorkspace = !!workspaceMatch && !wsTaskMatch && !wsTaskStreamMatch && !wsTaskFindingsMatch && !wsTaskEditMatch;
  const isNewTask = !!newTaskMatch;
  const isTaskEdit = !!taskEditMatch || !!wsTaskEditMatch;
  const isEmpty = !!emptyMatch && !isNewChat && !isWorkspace && !isNewTask;
  const isSettings = !!settingsMatch;

  // --- dashboard / settings / edit / new / environments / new_chat — empty ---
  if (isEmpty || isSettings || isTaskEdit || isNewTask || isEnvironments || isNewChat) {
    return <></>;
  }

  // --- /chat route — ChatInput handles input on the page; only show hint if no local env ---
  if (isChat) {
    const localEnv = environments.find((e) => e.adapterType === "local" && e.status === "connected");
    if (!localEnv) {
      return (
        <div className={styles.bar}>
          <span className={styles.hintText}>Add a local environment to start chatting</span>
        </div>
      );
    }
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
  if (taskId) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return (
        <div className={styles.bar}>
          <span className={styles.hintText}>Loading...</span>
        </div>
      );
    }

    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const isTaskBlocked = task.dependsOn.some((depId) => {
      const dep = tasksById.get(depId);
      return dep !== undefined && dep.status !== "complete";
    });

    // Not started (blocked or unblocked)
    if (task.status === "not_started") {
      const blockerNames = isTaskBlocked
        ? task.dependsOn
          .map((depId) => tasksById.get(depId))
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

    // Working / paused — check if session is active
    if (task.status === "working" || task.status === "paused") {
      const taskSessionId = task.latestSessionId || undefined;
      const taskSession = taskSessionId
        ? sessions.find((s) => s.id === taskSessionId)
        : undefined;
      const isActive = taskSession && !["completed", "failed", "interrupted", "hibernating"].includes(taskSession.status);

      // Active session — ChatInput on the page handles this; return empty
      if (isActive) {
        return <></>;
      }

      return (
        <div className={styles.bar}>
          <span className={styles.hintText}>Waiting for agent...</span>
        </div>
      );
    }

    // Complete
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

  // --- session mode ---
  if (sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    const isEnded = session !== undefined && ["completed", "failed", "interrupted", "hibernating"].includes(session.status);
    const isActive = session !== undefined && !isEnded;

    // Active session — ChatInput on the page handles this; return empty
    if (isActive) {
      return <></>;
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
