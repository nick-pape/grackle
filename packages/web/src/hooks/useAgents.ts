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
    async (
      name: string,
      avatar: string,
      primaryPersonaId: string,
      environmentId: string,
    ): Promise<AgentData> => {
      const resp = await grackleClient.createAgent({
        name,
        avatar,
        primaryPersonaId,
        environmentId,
      });
      const created = protoToAgent(resp);
      setAgents((prev) => [...prev.filter((a) => a.id !== created.id), created]);
      return created;
    },
    [],
  );

  const updateAgent = useCallback(
    async (id: string, updates: UpdateAgentFields): Promise<AgentData> => {
      // Proto3 optional fields treat `undefined` as absent, so passing the
      // raw `updates` (where unspecified fields are already `undefined`)
      // preserves the "keep" vs "clear" semantics with full type safety.
      const resp = await grackleClient.updateAgent({
        id,
        name: updates.name,
        avatar: updates.avatar,
        primaryPersonaId: updates.primaryPersonaId,
      });
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
