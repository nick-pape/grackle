/**
 * Domain hook for task management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import { ConnectError } from "@connectrpc/connect";
import type { TaskData, GrackleEvent, WsMessage, UseTasksResult } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToTask } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseTasksResult } from "@grackle-ai/web-components";

/**
 * Hook that manages task state and lifecycle actions via ConnectRPC.
 *
 * @returns Task state, actions, an event handler, and a disconnect callback.
 */
export function useTasks(): UseTasksResult {
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const { loading: tasksLoading, track: trackTasks } = useLoadingState();
  const [taskStartingId, setTaskStartingId] = useState<string | undefined>(
    undefined,
  );
  /** Per-workspace debounce timers to coalesce rapid domain events into one RPC. */
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /** Fetch tasks for a single workspace and merge into state. */
  const loadTasks = useCallback(async (workspaceId: string) => {
    try {
      const resp = await grackleClient.listTasks({ workspaceId });
      const incoming = resp.tasks.map(protoToTask);
      setTasks((prev) => [
        ...prev.filter((t) => t.workspaceId !== workspaceId),
        ...incoming,
      ]);
    } catch {
      // empty
    }
  }, []);

  /** Fetch all tasks (global, including workspace-less) and upsert into state. */
  const loadAllTasks = useCallback(async () => {
    try {
      const resp = await trackTasks(grackleClient.listTasks({}));
      const incoming = resp.tasks.map(protoToTask);
      setTasks((prev) => {
        const incomingIds = new Set(incoming.map((t) => t.id));
        return [
          ...prev.filter((t) => !incomingIds.has(t.id)),
          ...incoming,
        ];
      });
    } catch {
      // empty
    }
  }, [trackTasks]);

  /** Debounced refresh: coalesce rapid domain events for the same workspace. */
  const refreshTasksForEvent = useCallback((workspaceId: string, taskId: string) => {
    /** Schedule a debounced loadTasks for a workspace (200ms window). */
    const scheduleLoad = (wsId: string): void => {
      clearTimeout(debounceTimersRef.current[wsId]);
      debounceTimersRef.current[wsId] = setTimeout(() => {
        delete debounceTimersRef.current[wsId];
        loadTasks(wsId).catch(() => {});
      }, 200);
    };

    if (workspaceId) {
      scheduleLoad(workspaceId);
    } else if (taskId) {
      setTasks((prev) => {
        const found = prev.find((t) => t.id === taskId);
        if (found?.workspaceId) {
          scheduleLoad(found.workspaceId);
        } else {
          loadAllTasks().catch(() => {});
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
          loadTasks(createdWsId).catch(() => {});
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
    async (
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
      try {
        await grackleClient.createTask({
          workspaceId,
          title,
          description: description || "",
          dependsOn: dependsOn || [],
          parentTaskId: parentTaskId || "",
          defaultPersonaId: defaultPersonaId || undefined,
          canDecompose: canDecompose ?? undefined,
        });
        onSuccess?.();
      } catch (err) {
        const message = err instanceof ConnectError ? err.message : "Failed to create task";
        onError?.(message);
      }
    },
    [],
  );

  const startTask = useCallback(
    async (taskId: string, personaId?: string, environmentId?: string, notes?: string) => {
      setTaskStartingId(taskId);
      try {
        await grackleClient.startTask({
          taskId,
          personaId: personaId || "",
          environmentId: environmentId || "",
          notes: notes || "",
        });
      } catch {
        setTaskStartingId(undefined);
      }
    },
    [],
  );

  const stopTask = useCallback(
    async (taskId: string) => {
      try {
        await grackleClient.stopTask({ id: taskId });
      } catch {
        // empty
      }
    },
    [],
  );

  const completeTask = useCallback(
    async (taskId: string) => {
      try {
        await grackleClient.completeTask({ id: taskId });
      } catch {
        // empty
      }
    },
    [],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      try {
        await grackleClient.resumeTask({ id: taskId });
      } catch {
        // empty
      }
    },
    [],
  );

  const updateTask = useCallback(
    async (
      taskId: string,
      title: string,
      description: string,
      dependsOn: string[],
      defaultPersonaId?: string,
    ) => {
      try {
        await grackleClient.updateTask({
          id: taskId,
          title,
          description,
          dependsOn,
          ...(defaultPersonaId !== undefined ? { defaultPersonaId } : {}),
        });
      } catch {
        // empty
      }
    },
    [],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      try {
        await grackleClient.deleteTask({ id: taskId });
      } catch {
        // empty
      }
    },
    [],
  );

  return {
    tasks,
    tasksLoading,
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
