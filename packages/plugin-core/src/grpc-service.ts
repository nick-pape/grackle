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
import * as tokens from "./token-handlers.js";
import * as findings from "./finding-handlers.js";
import * as escalations from "./escalation-handlers.js";
import * as codespaces from "./codespace-handlers.js";
import * as settings from "./settings-handlers.js";
import * as pluginHandlers from "./plugin-handlers.js";
import * as githubAccounts from "./github-account-handlers.js";

/**
 * Create a `ServiceCollector` pre-loaded with all built-in Grackle handler groups.
 *
 * Use this when you need access to the collector itself (e.g., for testing or
 * to add plugin-contributed handlers before calling `buildRoutes()`).
 */
export function createDefaultCollector(): ServiceCollector {
  const collector = createServiceCollector();
  collector.addHandlers(grackle.GrackleCore, environments);
  collector.addHandlers(grackle.GrackleCore, sessions);
  collector.addHandlers(grackle.GrackleOrchestration, tasks);
  collector.addHandlers(grackle.GrackleCore, workspaces);
  collector.addHandlers(grackle.GrackleOrchestration, personas);
  collector.addHandlers(grackle.GrackleCore, tokens);
  collector.addHandlers(grackle.GrackleOrchestration, findings);
  collector.addHandlers(grackle.GrackleOrchestration, escalations);
  collector.addHandlers(grackle.GrackleCore, codespaces);
  collector.addHandlers(grackle.GrackleCore, settings);
  collector.addHandlers(grackle.GrackleCore, pluginHandlers);
  collector.addHandlers(grackle.GrackleCore, githubAccounts);
  return collector;
}

/**
 * Create a `ServiceCollector` pre-loaded with only the core (non-orchestration,
 * non-scheduling) Grackle handler groups: environments, sessions, workspaces,
 * tokens, codespaces, and settings.
 *
 * Orchestration handlers (tasks, personas, findings, escalations) are contributed
 * by `@grackle-ai/plugin-orchestration` via {@link createOrchestrationCollector}.
 * Schedule handlers are contributed by `@grackle-ai/plugin-scheduling`.
 * Knowledge handlers are contributed by `@grackle-ai/plugin-knowledge`.
 */
export function createCoreCollector(): ServiceCollector {
  const collector = createServiceCollector();
  collector.addHandlers(grackle.GrackleCore, environments);
  collector.addHandlers(grackle.GrackleCore, sessions);
  collector.addHandlers(grackle.GrackleCore, workspaces);
  collector.addHandlers(grackle.GrackleCore, tokens);
  collector.addHandlers(grackle.GrackleCore, codespaces);
  collector.addHandlers(grackle.GrackleCore, settings);
  collector.addHandlers(grackle.GrackleCore, pluginHandlers);
  collector.addHandlers(grackle.GrackleCore, githubAccounts);
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
  collector.addHandlers(grackle.GrackleOrchestration, tasks);
  collector.addHandlers(grackle.GrackleOrchestration, personas);
  collector.addHandlers(grackle.GrackleOrchestration, findings);
  collector.addHandlers(grackle.GrackleOrchestration, escalations);
  return collector;
}

/** Register all Grackle gRPC service handlers on the given ConnectRPC router. */
export function registerGrackleRoutes(router: ConnectRouter): void {
  createDefaultCollector().buildRoutes()(router);
}
