/**
 * Domain hook for task management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { ConnectError } from "@connectrpc/connect";
import type { TaskData, GrackleEvent, WsMessage } from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToTask } from "./proto-converters.js";

/** Values returned by {@link useTasks}. */
export interface UseTasksResult {
  /** All known tasks (may span multiple workspaces). */
  tasks: TaskData[];
  /** The ID of the task currently being started, or `undefined`. */
  taskStartingId: string | undefined;
  /** Load tasks for a given workspace. */
  loadTasks: (workspaceId: string) => void;
  /** Load all tasks across all workspaces. */
  loadAllTasks: () => void;
  /** Create a new task in a workspace. */
  createTask: (
    workspaceId: string,
    title: string,
    description?: string,
    dependsOn?: string[],
    parentTaskId?: string,
    defaultPersonaId?: string,
    canDecompose?: boolean,
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
  /** Stop a task: kill active sessions + mark complete. */
  stopTask: (taskId: string) => void;
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
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state (e.g. `taskStartingId`) on disconnect. */
  onDisconnect: () => void;
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
}

/**
 * Hook that manages task state and lifecycle actions via ConnectRPC.
 *
 * @returns Task state, actions, an event handler, and a disconnect callback.
 */
export function useTasks(): UseTasksResult {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [taskStartingId, setTaskStartingId] = useState<string | undefined>(
    undefined,
  );

  /** Fetch tasks for a single workspace and merge into state. */
  const loadTasks = useCallback((workspaceId: string) => {
    grackleClient.listTasks({ workspaceId }).then(
      (resp) => {
        const incoming = resp.tasks.map(protoToTask);
        setTasks((prev) => [
          ...prev.filter((t) => t.workspaceId !== workspaceId),
          ...incoming,
        ]);
      },
      () => {},
    );
  }, []);

  /** Fetch all tasks (global, including workspace-less) and upsert into state. */
  const loadAllTasks = useCallback(() => {
    grackleClient.listTasks({}).then(
      (resp) => {
        const incoming = resp.tasks.map(protoToTask);
        setTasks((prev) => {
          const incomingIds = new Set(incoming.map((t) => t.id));
          return [
            ...prev.filter((t) => !incomingIds.has(t.id)),
            ...incoming,
          ];
        });
      },
      () => {},
    );
  }, []);

  /** Helper to refresh tasks for a given workspace or globally. */
  const refreshTasksForEvent = useCallback((workspaceId: string, taskId: string) => {
    if (workspaceId) {
      loadTasks(workspaceId);
    } else if (taskId) {
      setTasks((prev) => {
        const found = prev.find((t) => t.id === taskId);
        if (found?.workspaceId) {
          loadTasks(found.workspaceId);
        } else {
          loadAllTasks();
        }
        return prev;
      });
    }
  }, [loadTasks, loadAllTasks]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    const p = event.payload;
    switch (event.type) {
      case "task.created": {
        const createdWsId = typeof p.workspaceId === "string" ? p.workspaceId : "";
        if (createdWsId) {
          loadTasks(createdWsId);
        }
        return true;
      }
      case "task.started": {
        const taskId = typeof p.taskId === "string" ? p.taskId : "";
        const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
        const startedWsId = typeof p.workspaceId === "string" ? p.workspaceId : "";

        setTaskStartingId((prev) =>
          taskId && prev === taskId ? undefined : prev,
        );
        if (sessionId && taskId) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, latestSessionId: sessionId } : t,
            ),
          );
        }
        refreshTasksForEvent(startedWsId, taskId);
        // Note: session refresh is handled by useGrackleSocket.routeDomainEvent
        return true;
      }
      case "task.completed":
      case "task.deleted":
      case "task.reparented":
      case "task.updated": {
        const eventWsId = typeof p.workspaceId === "string" ? p.workspaceId : "";
        const eventTaskId = typeof p.taskId === "string" ? p.taskId : "";
        refreshTasksForEvent(eventWsId, eventTaskId);
        return true;
      }
      default:
        return false;
    }
  }, [loadTasks, refreshTasksForEvent]);

  const onDisconnect = useCallback(() => {
    setTaskStartingId(undefined);
  }, []);

  const handleLegacyMessage = useCallback((msg: WsMessage): boolean => {
    if (msg.type === "tasks") {
      const incoming = Array.isArray(msg.payload?.tasks) ? msg.payload.tasks as TaskData[] : [];
      const pid = typeof msg.payload?.workspaceId === "string" && msg.payload.workspaceId
        ? msg.payload.workspaceId : "";
      if (!pid) {
        setTasks((prev) => {
          const incomingIds = new Set(incoming.map((t) => t.id));
          return [...prev.filter((t) => !incomingIds.has(t.id)), ...incoming];
        });
      } else {
        setTasks((prev) => [...prev.filter((t) => t.workspaceId !== pid), ...incoming]);
      }
      return true;
    }
    return false;
  }, []);

  const createTask = useCallback(
    (
      workspaceId: string,
      title: string,
      description?: string,
      dependsOn?: string[],
      parentTaskId?: string,
      defaultPersonaId?: string,
      canDecompose?: boolean,
      onSuccess?: () => void,
      onError?: (message: string) => void,
    ) => {
      grackleClient.createTask({
        workspaceId,
        title,
        description: description || "",
        dependsOn: dependsOn || [],
        parentTaskId: parentTaskId || "",
        defaultPersonaId: defaultPersonaId || undefined,
        canDecompose: canDecompose ?? undefined,
      }).then(
        () => { onSuccess?.(); },
        (err) => {
          const message = err instanceof ConnectError ? err.message : "Failed to create task";
          onError?.(message);
        },
      );
    },
    [],
  );

  const startTask = useCallback(
    (taskId: string, personaId?: string, environmentId?: string, notes?: string) => {
      setTaskStartingId(taskId);
      grackleClient.startTask({
        taskId,
        personaId: personaId || "",
        environmentId: environmentId || "",
        notes: notes || "",
      }).catch(() => {
        setTaskStartingId(undefined);
      });
    },
    [],
  );

  const stopTask = useCallback(
    (taskId: string) => {
      grackleClient.stopTask({ id: taskId }).catch(
        () => {},
      );
    },
    [],
  );

  const completeTask = useCallback(
    (taskId: string) => {
      grackleClient.completeTask({ id: taskId }).catch(
        () => {},
      );
    },
    [],
  );

  const resumeTask = useCallback(
    (taskId: string) => {
      grackleClient.resumeTask({ id: taskId }).catch(
        () => {},
      );
    },
    [],
  );

  const updateTask = useCallback(
    (
      taskId: string,
      title: string,
      description: string,
      dependsOn: string[],
      defaultPersonaId?: string,
    ) => {
      grackleClient.updateTask({
        id: taskId,
        title,
        description,
        dependsOn,
        ...(defaultPersonaId !== undefined ? { defaultPersonaId } : {}),
      }).catch(() => {});
    },
    [],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      grackleClient.deleteTask({ id: taskId }).catch(
        () => {},
      );
    },
    [],
  );

  return {
    tasks,
    taskStartingId,
    loadTasks,
    loadAllTasks,
    createTask,
    startTask,
    stopTask,
    completeTask,
    resumeTask,
    updateTask,
    deleteTask,
    handleEvent,
    onDisconnect,
    handleLegacyMessage,
  };
}
