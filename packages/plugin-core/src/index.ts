// ─── gRPC Handler Aggregator ─────────────────────────────────
export { createCoreCollector, createOrchestrationCollector, createDefaultCollector, registerGrackleRoutes } from "./grpc-service.js";

// ─── Subscriber Factories ───────────────────────────────────
export { createLifecycleSubscriber } from "./lifecycle.js";
export { createSigchldSubscriber } from "./signals/sigchld.js";
export { createEscalationAutoSubscriber } from "./signals/escalation-auto.js";
export { createOrphanReparentSubscriber, transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
export { createRootTaskBootSubscriber } from "./root-task-boot.js";
export type { RootTaskBootDeps } from "./root-task-boot.js";

// ─── Reconciliation Phases ──────────────────────────────────
export { createDispatchPhase } from "./dispatch-phase.js";
export type { DispatchPhaseDeps } from "./dispatch-phase.js";
export { createOrphanPhase } from "./orphan-phase.js";
export type { OrphanPhaseDeps } from "./orphan-phase.js";
export { lifecycleCleanupPhase } from "./lifecycle-cleanup.js";
export { createEnvironmentReconciliationPhase } from "./environment-reconciliation.js";
export type { EnvironmentReconciliationDeps } from "./environment-reconciliation.js";

// ─── Plugin Registry ────────────────────────────────────────
export { setLoadedPluginNames, PLUGIN_REGISTRY } from "./plugin-registry.js";
export type { PluginRegistryEntry } from "./plugin-registry.js";

// ─── Handler Utilities ──────────────────────────────────────
export { killSessionAndCleanup } from "./grpc-shared.js";

// ─── Re-exports from other modules ──────────────────────────
export { cleanupLifecycleStream, ensureLifecycleStream } from "./lifecycle.js";
export { toDialableHost, validatePipeInputs, resolveAncestorEnvironmentId, VALID_PIPE_MODES } from "./grpc-shared.js";
