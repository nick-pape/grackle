// ─── gRPC Service ───────────────────────────────────────────
export { registerGrackleRoutes, createDefaultCollector } from "./grpc-service.js";
export { createServiceCollector } from "./service-collector.js";
export type { ServiceCollector, HandlerGroup } from "./service-collector.js";

// ─── Adapter Management ────────────────────────────────────
export {
  registerAdapter, getAdapter,
  setConnection, getConnection, removeConnection, listConnections,
  startHeartbeat, stopHeartbeat,
} from "./adapter-manager.js";
export { parseAdapterConfig } from "./adapter-config.js";

// ─── Event System ──────────────────────────────────────────
export { emit, subscribe } from "./event-bus.js";

// ─── Subscriber Types ─────────────────────────────────────
export type { Disposable, PluginContext, SubscriberFactory } from "./subscriber-types.js";

// ─── Subscriber Factories ─────────────────────────────────
export { createSigchldSubscriber } from "./signals/sigchld.js";
export { createEscalationAutoSubscriber } from "./signals/escalation-auto.js";
export { createOrphanReparentSubscriber, transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
export { createLifecycleSubscriber } from "./lifecycle.js";
export { ensureStdinStream, publishToStdin, cleanupStdinStream } from "./stdin-delivery.js";

// ─── Task Session ───────────────────────────────────────────
export { startTaskSession } from "./task-session.js";
export { reanimateAgent } from "./reanimate-agent.js";

// ─── Session / Environment ─────────────────────────────────
export { attemptReconnects, resetReconnectState } from "./auto-reconnect.js";
export { pushToEnv } from "./token-push.js";
export { computeTaskStatus } from "./compute-task-status.js";

// ─── Knowledge ─────────────────────────────────────────────
export { isKnowledgeEnabled, initKnowledge, neo4jHealthCheck } from "./knowledge-init.js";
export { createKnowledgeHealthPhase, isNeo4jHealthy, getKnowledgeReadinessCheck } from "./knowledge-health.js";
export type { KnowledgeHealthPhaseDeps, KnowledgeReadinessCheck } from "./knowledge-health.js";

// ─── Reconciliation / Scheduling ──────────────────────────
export { ReconciliationManager } from "./reconciliation-manager.js";
export type { ReconciliationPhase } from "./reconciliation-manager.js";
export { createCronPhase } from "./cron-phase.js";
export type { CronPhaseDeps } from "./cron-phase.js";
export { createOrphanPhase } from "./orphan-phase.js";
export type { OrphanPhaseDeps } from "./orphan-phase.js";
export { findFirstConnectedEnvironment } from "./find-connected-environment.js";
export { createRootTaskBootSubscriber } from "./root-task-boot.js";
export type { RootTaskBootDeps } from "./root-task-boot.js";
export { validateExpression, computeNextRunAt } from "./schedule-expression.js";
export { lifecycleCleanupPhase } from "./lifecycle-cleanup.js";
export { createEnvironmentReconciliationPhase } from "./environment-reconciliation.js";
export type { EnvironmentReconciliationDeps } from "./environment-reconciliation.js";

// ─── Version Check ────────────────────────────────────────
export { checkVersionStatus, clearVersionCache, type VersionStatus } from "./version-check.js";

// ─── Logger ────────────────────────────────────────────────
export { logger } from "./logger.js";

// ─── Trace Context ──────────────────────────────────────────
export { getTraceId, runWithTrace, isValidTraceId, wrapAsyncIterableWithTrace } from "./trace-context.js";

// ─── Utilities ─────────────────────────────────────────────
export { exec } from "./utils/exec.js";
export { detectLanIp } from "./utils/network.js";
