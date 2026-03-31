/**
 * Domain hook for schedule management.
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the WebSocket
 * event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import type { ScheduleData, GrackleEvent, UseSchedulesResult, ScheduleUpdate } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { schedulingClient as grackleClient } from "./useGrackleClient.js";
import { protoToSchedule } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseSchedulesResult } from "@grackle-ai/web-components";

/**
 * Hook that manages schedule state and CRUD actions via ConnectRPC.
 *
 * @returns Schedule state, actions, and an event handler.
 */
export function useSchedules(): UseSchedulesResult {
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const { loading: schedulesLoading, track: trackSchedules } = useLoadingState();
  /** Debounce timer to coalesce rapid schedule.fired events into a single reload. */
  const firedDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadSchedules = useCallback(async () => {
    try {
      const resp = await trackSchedules(grackleClient.listSchedules({}));
      setSchedules(resp.schedules.map(protoToSchedule));
    } catch {
      // empty
    }
  }, [trackSchedules]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    switch (event.type) {
      case "schedule.created":
      case "schedule.updated":
      case "schedule.deleted":
        loadSchedules().catch(() => {});
        return true;
      case "schedule.fired":
        // Debounce reloads for fired events — schedules can fire rapidly at short intervals.
        clearTimeout(firedDebounceRef.current);
        firedDebounceRef.current = setTimeout(() => { loadSchedules().catch(() => {}); }, 500);
        return true;
      default:
        return false;
    }
  }, [loadSchedules]);

  const createSchedule = useCallback(
    async (
      title: string,
      description: string,
      scheduleExpression: string,
      personaId: string,
      environmentId?: string,
      workspaceId?: string,
      parentTaskId?: string,
    ): Promise<ScheduleData> => {
      const resp = await grackleClient.createSchedule({
        title,
        description,
        scheduleExpression,
        personaId,
        environmentId: environmentId || "",
        workspaceId: workspaceId || "",
        parentTaskId: parentTaskId || "",
      });
      const created = protoToSchedule(resp);
      setSchedules((prev) => [...prev.filter((s) => s.id !== created.id), created]);
      return created;
    },
    [],
  );

  const updateSchedule = useCallback(
    async (scheduleId: string, fields: ScheduleUpdate): Promise<ScheduleData> => {
      const request: Record<string, unknown> = { id: scheduleId };
      if (fields.title !== undefined) { request.title = fields.title; }
      if (fields.description !== undefined) { request.description = fields.description; }
      if (fields.scheduleExpression !== undefined) { request.scheduleExpression = fields.scheduleExpression; }
      if (fields.personaId !== undefined) { request.personaId = fields.personaId; }
      if (fields.environmentId !== undefined) { request.environmentId = fields.environmentId; }
      if (fields.enabled !== undefined) { request.enabled = fields.enabled; }
      const resp = await grackleClient.updateSchedule(request);
      const updated = protoToSchedule(resp);
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      return updated;
    },
    [],
  );

  const deleteSchedule = useCallback(
    async (scheduleId: string): Promise<void> => {
      await grackleClient.deleteSchedule({ id: scheduleId });
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
    },
    [],
  );

  const domainHook: DomainHook = {
    onConnect: () => loadSchedules(),
    onDisconnect: () => { clearTimeout(firedDebounceRef.current); },
    handleEvent,
  };

  return { schedules, schedulesLoading, loadSchedules, createSchedule, updateSchedule, deleteSchedule, handleEvent, domainHook };
}
