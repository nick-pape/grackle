/**
 * Auto-create the root task for a new Agent (#1418).
 *
 * Listens for `agent.created` and inserts a `kind=root` task tied to the
 * Agent. Idempotent: re-emitting the event (or seeing it twice via
 * domain-events replay) is a no-op when the root already exists.
 *
 * This module is deliberately thin — no reanimation, no backoff. The Agent's
 * root task is an inert anchor that future tickets (heartbeat #1438,
 * schedule reroute #1439, channels #1421) attach sessions/children under.
 *
 * @module
 */

import type { AgentRow, TaskRow } from "@grackle-ai/database";
import type { Disposable, GrackleEvent, PluginContext } from "@grackle-ai/plugin-sdk";
import { logger } from "@grackle-ai/core";

/** Dependencies injected for testability. */
export interface AgentRootTaskBootDeps {
  /** Look up an Agent by id. Returns `undefined` if the agent was deleted before the subscriber ran. */
  getAgent: (id: string) => AgentRow | undefined;
  /** Look up the existing root task for an Agent (`kind=root`). Returns `undefined` if none. */
  getRootTaskForAgent: (agentId: string) => TaskRow | undefined;
  /** Insert a task row. Mirrors `taskStore.insertTask`'s shape. */
  insertTask: (fields: {
    id: string;
    title: string;
    description: string;
    branch: string;
    dependsOn: string[];
    parentTaskId: string;
    depth: number;
    canDecompose: boolean;
    injectKnowledge: boolean;
    defaultPersonaId: string;
    tokenBudget: number;
    costBudgetMillicents: number;
    agentId?: string;
    kind?: string;
  }) => void;
  /** Mint a fresh task id. UUID factory injected so tests can be deterministic. */
  newId: () => string;
}

/**
 * Idempotent root-task creation for an `agent.created` event.
 *
 * Exported separately from the subscriber factory so unit tests can drive
 * the handler synchronously without going through the event bus.
 */
export function handleAgentCreated(
  deps: AgentRootTaskBootDeps,
  payload: { agentId: string },
): void {
  const agent = deps.getAgent(payload.agentId);
  if (!agent) {
    // Agent was deleted between emit and handler-fire. Safe no-op.
    logger.debug(
      { agentId: payload.agentId },
      "agent-root-task-boot: agent no longer exists, skipping root task creation",
    );
    return;
  }
  if (deps.getRootTaskForAgent(agent.id)) {
    // Already created (subscriber re-fire, server restart with persisted events, etc.).
    return;
  }
  deps.insertTask({
    id: deps.newId(),
    title: agent.name,
    description: "",
    branch: "",
    dependsOn: [],
    parentTaskId: "",
    depth: 0,
    canDecompose: true,
    // Root tasks for agents don't need KG injection — they're inert anchors
    // until a wake-up surface (#1438/#1439/#1421) attaches real work.
    injectKnowledge: false,
    defaultPersonaId: agent.primaryPersonaId,
    tokenBudget: 0,
    costBudgetMillicents: 0,
    agentId: agent.id,
    kind: "root",
  });
  logger.debug(
    { agentId: agent.id, agentName: agent.name },
    "agent-root-task-boot: created root task",
  );
}

/**
 * Create the agent-root-task subscriber.
 *
 * Subscribes to `agent.created` and (re)dispatches `handleAgentCreated` for
 * each event. Returns a `Disposable` that unsubscribes on dispose.
 *
 * @param ctx - Plugin context providing event-bus access.
 * @param deps - Injected dependencies for testability.
 */
export function createAgentRootTaskSubscriber(
  ctx: PluginContext,
  deps: AgentRootTaskBootDeps,
): Disposable {
  const unsubscribe = ctx.subscribe((event: GrackleEvent) => {
    if (event.type !== "agent.created") {
      return;
    }
    const payload = event.payload as { agentId?: string };
    if (!payload.agentId) {
      return;
    }
    try {
      handleAgentCreated(deps, { agentId: payload.agentId });
    } catch (err: unknown) {
      logger.warn(
        { err, agentId: payload.agentId },
        "agent-root-task-boot: failed to create root task",
      );
    }
  });

  return {
    dispose(): void {
      unsubscribe();
    },
  };
}
