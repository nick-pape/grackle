// ─── gRPC Handler Aggregator ─────────────────────────────────
export { createDefaultCollector, registerGrackleRoutes } from "./grpc-service.js";

// ─── Subscriber Factories ───────────────────────────────────
export { createLifecycleSubscriber } from "./lifecycle.js";
export { createSigchldSubscriber } from "./signals/sigchld.js";
export { createEscalationAutoSubscriber } from "./signals/escalation-auto.js";
export { createOrphanReparentSubscriber, transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
export { createRootTaskBootSubscriber } from "./root-task-boot.js";
export type { RootTaskBootDeps } from "./root-task-boot.js";
export { sendInputToSession } from "./signals/signal-delivery.js";

// ─── Reconciliation Phases ──────────────────────────────────
export { createCronPhase } from "./cron-phase.js";
export type { CronPhaseDeps } from "./cron-phase.js";
export { createDispatchPhase } from "./dispatch-phase.js";
export type { DispatchPhaseDeps } from "./dispatch-phase.js";
export { createOrphanPhase } from "./orphan-phase.js";
export type { OrphanPhaseDeps } from "./orphan-phase.js";
export { lifecycleCleanupPhase } from "./lifecycle-cleanup.js";
export { createEnvironmentReconciliationPhase } from "./environment-reconciliation.js";
export type { EnvironmentReconciliationDeps } from "./environment-reconciliation.js";

// ─── Handler Utilities ──────────────────────────────────────
export { killSessionAndCleanup } from "./grpc-shared.js";

// ─── Re-exports from core (convenience) ─────────────────────
export { cleanupLifecycleStream, ensureLifecycleStream } from "./lifecycle.js";
export { routeEscalation, deliverPendingEscalations } from "./notification-router.js";
export { buildMcpServersJson, personaMcpServersToJson } from "./grpc-mcp-config.js";
export { toPersonaResolveInput, buildOrchestratorContextInput } from "./persona-mapper.js";
export { toDialableHost, validatePipeInputs, resolveAncestorEnvironmentId, VALID_PIPE_MODES } from "./grpc-shared.js";
export {
  createKnowledgeHealthPhase, isNeo4jHealthy, getKnowledgeReadinessCheck, resetKnowledgeHealthState,
} from "./knowledge-health.js";
export type { KnowledgeHealthPhaseDeps, KnowledgeReadinessCheck } from "./knowledge-health.js";
