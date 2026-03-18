/**
 * Domain hook for task management.
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import type { TaskData, WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { asValidArray, isTaskData } from "./types.js";

/** Pending create-task callback entry keyed by requestId. */
interface PendingCreateCallback {
  onSuccess: () => void;
  onError: (message: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long to wait for a server response before timing out a create request. */
const CREATE_TASK_TIMEOUT_MS: number = 15_000;

/** Values returned by {@link useTasks}. */
export interface UseTasksResult {
  /** All known tasks (may span multiple projects). */
  tasks: TaskData[];
  /** The ID of the task currently being started, or `undefined`. */
  taskStartingId: string | undefined;
  /** Load tasks for a given project. */
  loadTasks: (projectId: string) => void;
  /** Create a new task in a project. */
  createTask: (
    projectId: string,
    title: string,
    description?: string,
    dependsOn?: string[],
    parentTaskId?: string,
    defaultPersonaId?: string,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => void;
  /** Start a task, optionally specifying runtime parameters. */
  startTask: (
    taskId: string,
    personaId?: string,
    environmentId?: string,
    notes?: string,
  ) => void;
  /** Mark a task as completed. */
  completeTask: (taskId: string) => void;
  /** Resume a paused/waiting task. */
  resumeTask: (taskId: string) => void;
  /** Update a task's title, description, dependencies, and default persona. */
  updateTask: (
    taskId: string,
    title: string,
    description: string,
    dependsOn: string[],
    defaultPersonaId?: string,
  ) => void;
  /** Delete a task by ID. */
  deleteTask: (taskId: string) => void;
  /** Handle an incoming WebSocket message. Returns `true` if handled. */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state (e.g. `taskStartingId`) on disconnect. */
  onDisconnect: () => void;
}

/**
 * Hook that manages task state and lifecycle actions.
 *
 * @param send - Function to send WebSocket messages.
 * @returns Task state, actions, a message handler, and a disconnect callback.
 */
export function useTasks(send: SendFunction): UseTasksResult {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [taskStartingId, setTaskStartingId] = useState<string | undefined>(
    undefined,
  );
  const pendingCreatesRef = useRef<Map<string, PendingCreateCallback>>(
    new Map(),
  );

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    const p = event.payload;
    switch (event.type) {
      case "task.created": {
        const reqId = typeof p.requestId === "string" ? p.requestId : "";
        if (reqId) {
          const pending = pendingCreatesRef.current.get(reqId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingCreatesRef.current.delete(reqId);
            pending.onSuccess();
          }
        }
        const pid = typeof p.projectId === "string" ? p.projectId : "";
        if (pid) {
          send({ type: "list_tasks", payload: { projectId: pid } });
        }
        return true;
      }
      case "task.started": {
        const taskId = typeof p.taskId === "string" ? p.taskId : "";
        const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
        const pid = typeof p.projectId === "string" ? p.projectId : "";

        setTaskStartingId((prev) =>
          taskId && prev === taskId ? undefined : prev,
        );
        if (sessionId) {
          send({ type: "list_sessions" });
          if (taskId) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, latestSessionId: sessionId } : t,
              ),
            );
          }
        }
        if (pid) {
          send({ type: "list_tasks", payload: { projectId: pid } });
        } else if (taskId) {
          setTasks((prev) => {
            const found = prev.find((t) => t.id === taskId);
            if (found) {
              send({ type: "list_tasks", payload: { projectId: found.projectId } });
            }
            return prev;
          });
        }
        return true;
      }
      case "task.completed":
      case "task.deleted":
      case "task.updated": {
        const pid = typeof p.projectId === "string" ? p.projectId : "";
        const taskId = typeof p.taskId === "string" ? p.taskId : "";
        if (pid) {
          send({ type: "list_tasks", payload: { projectId: pid } });
        } else if (taskId) {
          setTasks((prev) => {
            const found = prev.find((t) => t.id === taskId);
            if (found) {
              send({ type: "list_tasks", payload: { projectId: found.projectId } });
            }
            return prev;
          });
        }
        return true;
      }
      default:
        return false;
    }
  }, [send]);

  const handleMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "tasks": {
        const incoming = asValidArray(
          msg.payload?.tasks,
          isTaskData,
          "tasks",
          "tasks",
        );
        const pid =
          (typeof msg.payload?.projectId === "string"
            ? msg.payload.projectId
            : "") || (incoming.length > 0 ? incoming[0].projectId : "");
        if (!pid) {
          setTasks(incoming);
          return true;
        }
        setTasks((prev) => [
          ...prev.filter((t) => t.projectId !== pid),
          ...incoming,
        ]);
        return true;
      }
      case "create_task_error": {
        const errorReqId =
          typeof msg.payload?.requestId === "string"
            ? msg.payload.requestId
            : "";
        const errorMessage =
          typeof msg.payload?.message === "string"
            ? msg.payload.message
            : "Failed to create task";
        if (errorReqId) {
          const pending = pendingCreatesRef.current.get(errorReqId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingCreatesRef.current.delete(errorReqId);
            pending.onError(errorMessage);
          } else {
            console.error("[useTasks] create_task_error with unknown requestId:", errorMessage);
          }
        } else {
          console.error("[useTasks] create_task_error:", errorMessage);
        }
        return true;
      }
      default:
        return false;
    }
  }, []);

  const onDisconnect = useCallback(() => {
    setTaskStartingId(undefined);
    for (const [, pending] of pendingCreatesRef.current) {
      clearTimeout(pending.timer);
      pending.onError("Disconnected");
    }
    pendingCreatesRef.current.clear();
  }, []);

  const loadTasks = useCallback(
    (projectId: string) => {
      send({ type: "list_tasks", payload: { projectId } });
    },
    [send],
  );

  const createTask = useCallback(
    (
      projectId: string,
      title: string,
      description?: string,
      dependsOn?: string[],
      parentTaskId?: string,
      defaultPersonaId?: string,
      onSuccess?: () => void,
      onError?: (message: string) => void,
    ) => {
      const payload: Record<string, unknown> = {
        projectId,
        title,
        description: description || "",
        dependsOn: dependsOn || [],
        parentTaskId: parentTaskId || "",
        defaultPersonaId: defaultPersonaId || "",
      };
      if (onSuccess || onError) {
        const requestId = crypto.randomUUID();
        payload.requestId = requestId;
        const errorCb = onError ?? (() => {});
        const timer = setTimeout(() => {
          if (pendingCreatesRef.current.delete(requestId)) {
            errorCb("Request timed out");
          }
        }, CREATE_TASK_TIMEOUT_MS);
        pendingCreatesRef.current.set(requestId, {
          onSuccess: onSuccess ?? (() => {}),
          onError: errorCb,
          timer,
        });
      }
      send({ type: "create_task", payload });
    },
    [send],
  );

  const startTask = useCallback(
    (taskId: string, personaId?: string, environmentId?: string, notes?: string) => {
      setTaskStartingId(taskId);
      send({
        type: "start_task",
        payload: {
          taskId,
          personaId: personaId || "",
          environmentId: environmentId || "",
          notes: notes || "",
        },
      });
    },
    [send],
  );

  const completeTask = useCallback(
    (taskId: string) => {
      send({ type: "complete_task", payload: { taskId } });
    },
    [send],
  );

  const resumeTask = useCallback(
    (taskId: string) => {
      send({ type: "resume_task", payload: { taskId } });
    },
    [send],
  );

  const updateTask = useCallback(
    (
      taskId: string,
      title: string,
      description: string,
      dependsOn: string[],
      defaultPersonaId?: string,
    ) => {
      const payload: Record<string, unknown> = {
        taskId,
        title,
        description,
        dependsOn,
      };
      if (defaultPersonaId !== undefined) {
        payload.defaultPersonaId = defaultPersonaId;
      }
      send({
        type: "update_task",
        payload,
      });
    },
    [send],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      send({ type: "delete_task", payload: { taskId } });
    },
    [send],
  );

  return {
    tasks,
    taskStartingId,
    loadTasks,
    createTask,
    startTask,
    completeTask,
    resumeTask,
    updateTask,
    deleteTask,
    handleMessage,
    handleEvent,
    onDisconnect,
  };
}
