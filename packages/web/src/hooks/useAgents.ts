/**
 * Domain hook for agent management (#1417).
 *
 * Uses ConnectRPC for all CRUD operations. Domain events from the event bus
 * trigger re-fetches. Phase 0: agents are minimal context-axis entities with
 * no lifecycle.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type {
  AgentData,
  GrackleEvent,
  UseAgentsResult,
  UpdateAgentFields,
} from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { orchestrationClient as grackleClient } from "./useGrackleClient.js";
import { protoToAgent } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseAgentsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages agent state and CRUD actions via ConnectRPC.
 *
 * @returns Agent state, actions, and an event handler.
 */
export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const { loading: agentsLoading, track: trackAgents } = useLoadingState();

  const loadAgents = useCallback(async () => {
    try {
      const resp = await trackAgents(grackleClient.listAgents({}));
      setAgents(resp.agents.map(protoToAgent));
    } catch {
      // empty
    }
  }, [trackAgents]);

  const handleEvent = useCallback(
    (event: GrackleEvent): boolean => {
      switch (event.type) {
        case "agent.created":
        case "agent.updated":
        case "agent.deleted":
          loadAgents().catch(() => {});
          return true;
        default:
          return false;
      }
    },
    [loadAgents],
  );

  const createAgent = useCallback(
    async (name: string, avatar?: string, primaryPersonaId?: string): Promise<AgentData> => {
      const resp = await grackleClient.createAgent({
        name,
        avatar: avatar ?? "",
        primaryPersonaId: primaryPersonaId ?? "",
      });
      const created = protoToAgent(resp);
      setAgents((prev) => [...prev.filter((a) => a.id !== created.id), created]);
      return created;
    },
    [],
  );

  const updateAgent = useCallback(
    async (id: string, updates: UpdateAgentFields): Promise<AgentData> => {
      // Only send defined fields so the server distinguishes "keep" from "clear".
      const request: Record<string, unknown> = { id };
      if (updates.name !== undefined) {
        request.name = updates.name;
      }
      if (updates.avatar !== undefined) {
        request.avatar = updates.avatar;
      }
      if (updates.primaryPersonaId !== undefined) {
        request.primaryPersonaId = updates.primaryPersonaId;
      }
      const resp = await grackleClient.updateAgent(request);
      const updated = protoToAgent(resp);
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      return updated;
    },
    [],
  );

  const deleteAgent = useCallback(async (id: string): Promise<void> => {
    await grackleClient.deleteAgent({ id });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const domainHook: DomainHook = {
    onConnect: () => loadAgents(),
    onDisconnect: () => {},
    handleEvent,
  };

  return {
    agents,
    agentsLoading,
    loadAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    handleEvent,
    domainHook,
  };
}
