/**
 * Incremental entity projection via the domain event bus (#1258).
 *
 * Subscribes to entity mutation events and projects/unprojects the affected
 * node low-latency, as an optimization on top of the reconciliation phase
 * (which remains the correctness backbone). Only events with a precise entity
 * id in their payload are handled here; coarse events (e.g. `environment.changed`
 * with an empty payload) and sessions/transcripts are left to the phase.
 *
 * Fire-and-forget: handler errors are logged, never propagated — a missed
 * projection is reconciled on the next scan.
 *
 * @module
 */

import type { GrackleEvent, PluginContext, Disposable } from "@grackle-ai/plugin-sdk";
import { taskStore, workspaceStore, personaStore } from "@grackle-ai/database";
import { logger } from "./logger.js";
import { getKnowledgeEmbedder } from "./knowledge-init.js";
import { isNeo4jHealthy } from "./knowledge-health.js";
import {
  projectTask,
  unprojectTask,
  projectWorkspace,
  projectPersona,
  unprojectPersona,
  unprojectEnvironment,
} from "./projection/project-entity.js";

/** Read a non-empty string field from an event payload, or `undefined`. */
function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Dispatch one entity mutation event to the projection. */
async function handleEvent(event: GrackleEvent): Promise<void> {
  // Only project when knowledge is initialized and Neo4j is reachable; otherwise
  // the reconciliation phase will converge the graph once it recovers.
  if (!getKnowledgeEmbedder() || !isNeo4jHealthy()) {
    return;
  }

  const { payload } = event;
  switch (event.type) {
    case "task.created":
    case "task.updated":
    case "task.started":
    case "task.completed":
    case "task.reparented": {
      const taskId = stringField(payload, "taskId");
      if (!taskId) {
        return;
      }
      const task = taskStore.getTask(taskId);
      if (task) {
        await projectTask(task);
      }
      break;
    }
    case "task.deleted": {
      const taskId = stringField(payload, "taskId");
      if (taskId) {
        await unprojectTask(taskId);
      }
      break;
    }
    case "workspace.created":
    case "workspace.updated":
    case "workspace.archived": {
      // Archive is not a delete — the row remains (status="archived") and the
      // node is re-projected with the updated status.
      const workspaceId = stringField(payload, "workspaceId");
      if (!workspaceId) {
        return;
      }
      const workspace = workspaceStore.getWorkspace(workspaceId);
      if (workspace) {
        await projectWorkspace(workspace);
      }
      break;
    }
    case "persona.created":
    case "persona.updated": {
      const personaId = stringField(payload, "personaId");
      if (!personaId) {
        return;
      }
      const persona = personaStore.getPersona(personaId);
      if (persona) {
        await projectPersona(persona);
      }
      break;
    }
    case "persona.deleted": {
      const personaId = stringField(payload, "personaId");
      if (personaId) {
        await unprojectPersona(personaId);
      }
      break;
    }
    case "environment.removed": {
      const environmentId = stringField(payload, "environmentId");
      if (environmentId) {
        await unprojectEnvironment(environmentId);
      }
      break;
    }
    default:
      // sessions, transcript chunks, environment.changed (empty payload),
      // and non-entity events are handled by the reconciliation phase.
      break;
  }
}

/**
 * Subscribe to entity mutation events and incrementally project them.
 *
 * @returns A {@link Disposable} that unsubscribes from the event bus.
 */
export function createEntitySyncSubscriber(ctx: PluginContext): Disposable {
  const unsubscribe = ctx.subscribe((event) => {
    handleEvent(event).catch((err: unknown) => {
      logger.error({ err, eventType: event.type }, "Knowledge entity sync failed");
    });
  });
  return { dispose: unsubscribe };
}
