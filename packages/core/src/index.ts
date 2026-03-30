// ─── Service Collector ────────────────────────────────────────
export { createServiceCollector } from "./service-collector.js";
export type { ServiceCollector, HandlerGroup } from "./service-collector.js";

// ─── Adapter Management ──────────────────────────────────────
export {
  registerAdapter, getAdapter,
  setConnection, getConnection, removeConnection, listConnections,
  startHeartbeat, stopHeartbeat,
} from "./adapter-manager.js";
export { parseAdapterConfig } from "./adapter-config.js";

// ─── Event System ────────────────────────────────────────────
export { emit, subscribe } from "./event-bus.js";
export type { GrackleEvent, GrackleEventType, Subscriber } from "./event-bus.js";

// ─── Subscriber Types ────────────────────────────────────────
export type { Disposable, PluginContext, SubscriberFactory } from "./subscriber-types.js";

// ─── Task Session ────────────────────────────────────────────
export { startTaskSession } from "./task-session.js";
export { reanimateAgent } from "./reanimate-agent.js";

// ─── Session / Environment ───────────────────────────────────
export { attemptReconnects, resetReconnectState } from "./auto-reconnect.js";
export { pushToEnv } from "./token-push.js";
export { computeTaskStatus } from "./compute-task-status.js";
export type { TaskStatusResult } from "./compute-task-status.js";
export { findFirstConnectedEnvironment } from "./find-connected-environment.js";
export { hasCapacity, getEffectiveLimit } from "./concurrency.js";
export type { ConcurrencyDeps } from "./concurrency.js";

// ─── Dispatch / Budget (new from #1144, #1146) ──────────────
export { resolveDispatchEnvironment } from "./resolve-dispatch-environment.js";
export type { ResolveEnvironmentDeps } from "./resolve-dispatch-environment.js";
export { checkBudget, costUsdToMillicents } from "./budget-checker.js";
export type { BudgetExceeded } from "./budget-checker.js";
export { sendInputToSession } from "./signals/signal-delivery.js";

// ─── Knowledge ───────────────────────────────────────────────
export { isKnowledgeEnabled, initKnowledge, neo4jHealthCheck, getKnowledgeEmbedder } from "./knowledge-init.js";

// ─── Reconciliation Manager ─────────────────────────────────
export { ReconciliationManager } from "./reconciliation-manager.js";
export type { ReconciliationPhase } from "./reconciliation-manager.js";

// ─── Version Check ───────────────────────────────────────────
export { checkVersionStatus, clearVersionCache, type VersionStatus } from "./version-check.js";

// ─── Logger ──────────────────────────────────────────────────
export { logger } from "./logger.js";

// ─── Trace Context ───────────────────────────────────────────
export { getTraceId, runWithTrace, isValidTraceId, wrapAsyncIterableWithTrace } from "./trace-context.js";

// ─── Utilities ───────────────────────────────────────────────
export { exec } from "./utils/exec.js";
export { detectLanIp } from "./utils/network.js";

// ─── Namespace Exports (for plugin-core handler imports) ─────
export * as streamHub from "./stream-hub.js";
export * as streamRegistry from "./stream-registry.js";
export * as adapterManager from "./adapter-manager.js";
export * as processorRegistry from "./processor-registry.js";
export * as tokenPush from "./token-push.js";
export * as logWriter from "./log-writer.js";
export * as pipeDelivery from "./pipe-delivery.js";

// ─── Individual Exports for Plugin-Core ──────────────────────
export { processEventStream } from "./event-processor.js";
export { createEventStream } from "./event-hub.js";
export { recoverSuspendedSessions } from "./session-recovery.js";
export { clearReconnectState } from "./auto-reconnect.js";
export { resolveBootstrapRuntime } from "./resolve-bootstrap-runtime.js";
export { ensureStdinStream, publishToStdin, cleanupStdinStream } from "./stdin-delivery.js";
export { ensureLifecycleStream, cleanupLifecycleStream } from "./lifecycle-streams.js";
export { ensureAsyncDeliveryListener } from "./pipe-delivery.js";
export { readLastTextEntry } from "./log-writer.js";

// ─── Shared Utilities (used by both core and plugin-core) ────
export { routeEscalation, deliverPendingEscalations } from "./notification-router.js";
export {
  createKnowledgeHealthPhase, isNeo4jHealthy, getKnowledgeReadinessCheck, resetKnowledgeHealthState,
} from "./knowledge-health.js";
export type { KnowledgeHealthPhaseDeps, KnowledgeReadinessCheck } from "./knowledge-health.js";
export { buildMcpServersJson, personaMcpServersToJson } from "./grpc-mcp-config.js";
export { toDialableHost, validatePipeInputs, resolveAncestorEnvironmentId, VALID_PIPE_MODES } from "./grpc-shared-utils.js";
export { toPersonaResolveInput, buildOrchestratorContextInput } from "./persona-mapper.js";
