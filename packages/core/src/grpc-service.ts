import type { ConnectRouter } from "@connectrpc/connect";
import { grackle } from "@grackle-ai/common";
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

// Re-export shared helpers that existing test files
// (to-dialable-host.test.ts, resolve-ancestor-env.test.ts)
// import directly from this module.
export { toDialableHost, resolveAncestorEnvironmentId } from "./grpc-shared.js";
export { buildMcpServersJson } from "./grpc-mcp-config.js";

/** Register all Grackle gRPC service handlers on the given ConnectRPC router. */
export function registerGrackleRoutes(router: ConnectRouter): void {
  router.service(grackle.Grackle, {
    ...environments,
    ...sessions,
    ...tasks,
    ...workspaces,
    ...personas,
    ...schedules,
    ...tokens,
    ...findings,
    ...escalations,
    ...codespaces,
    ...knowledge,
    ...settings,
  });
}
