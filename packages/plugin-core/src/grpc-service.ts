/**
 * gRPC handler aggregator — creates a ServiceCollector pre-loaded with all
 * built-in Grackle handler groups.
 *
 * Previously in `@grackle-ai/core/grpc-service.ts`, moved here because all
 * handler modules now live in `@grackle-ai/plugin-core`.
 *
 * @module
 */

import { grackle } from "@grackle-ai/common";
import { createServiceCollector, type ServiceCollector } from "@grackle-ai/core";
import type { ConnectRouter } from "@connectrpc/connect";
import * as environments from "./environment-handlers.js";
import * as sessions from "./session-handlers.js";
import * as tasks from "./task-handlers.js";
import * as workspaces from "./workspace-handlers.js";
import * as personas from "./persona-handlers.js";
import * as schedules from "./schedule-handlers.js";
import * as tokens from "./token-handlers.js";
import * as findings from "./finding-handlers.js";
import * as escalations from "./escalation-handlers.js";
import * as codespaces from "./codespace-handlers.js";
import * as knowledge from "./knowledge-handlers.js";
import * as settings from "./settings-handlers.js";

/**
 * Create a `ServiceCollector` pre-loaded with all built-in Grackle handler groups.
 *
 * Use this when you need access to the collector itself (e.g., for testing or
 * to add plugin-contributed handlers before calling `buildRoutes()`).
 */
export function createDefaultCollector(): ServiceCollector {
  const collector = createServiceCollector();
  collector.addHandlers(grackle.Grackle, environments);
  collector.addHandlers(grackle.Grackle, sessions);
  collector.addHandlers(grackle.Grackle, tasks);
  collector.addHandlers(grackle.Grackle, workspaces);
  collector.addHandlers(grackle.Grackle, personas);
  collector.addHandlers(grackle.Grackle, schedules);
  collector.addHandlers(grackle.Grackle, tokens);
  collector.addHandlers(grackle.Grackle, findings);
  collector.addHandlers(grackle.Grackle, escalations);
  collector.addHandlers(grackle.Grackle, codespaces);
  collector.addHandlers(grackle.Grackle, knowledge);
  collector.addHandlers(grackle.Grackle, settings);
  return collector;
}

/**
 * Create a `ServiceCollector` pre-loaded with only the core (non-orchestration)
 * Grackle handler groups: environments, sessions, workspaces, schedules, tokens,
 * codespaces, knowledge, and settings.
 *
 * Orchestration handlers (tasks, personas, findings, escalations) are intentionally
 * excluded — they are contributed by `@grackle-ai/plugin-orchestration` via
 * {@link createOrchestrationCollector}.
 */
export function createCoreCollector(): ServiceCollector {
  const collector = createServiceCollector();
  collector.addHandlers(grackle.Grackle, environments);
  collector.addHandlers(grackle.Grackle, sessions);
  collector.addHandlers(grackle.Grackle, workspaces);
  collector.addHandlers(grackle.Grackle, schedules);
  collector.addHandlers(grackle.Grackle, tokens);
  collector.addHandlers(grackle.Grackle, codespaces);
  collector.addHandlers(grackle.Grackle, knowledge);
  collector.addHandlers(grackle.Grackle, settings);
  return collector;
}

/**
 * Create a `ServiceCollector` pre-loaded with only the orchestration handler
 * groups: tasks, personas, findings, and escalations.
 *
 * Use this in `@grackle-ai/plugin-orchestration` to contribute the 21
 * orchestration RPCs without duplicating the handler imports.
 */
export function createOrchestrationCollector(): ServiceCollector {
  const collector = createServiceCollector();
  collector.addHandlers(grackle.Grackle, tasks);
  collector.addHandlers(grackle.Grackle, personas);
  collector.addHandlers(grackle.Grackle, findings);
  collector.addHandlers(grackle.Grackle, escalations);
  return collector;
}

/** Register all Grackle gRPC service handlers on the given ConnectRPC router. */
export function registerGrackleRoutes(router: ConnectRouter): void {
  createDefaultCollector().buildRoutes()(router);
}
