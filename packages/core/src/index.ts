// ─── gRPC Service ───────────────────────────────────────────
export { registerGrackleRoutes } from "./grpc-service.js";

// ─── Adapter Management ────────────────────────────────────
export {
  registerAdapter, getAdapter,
  setConnection, getConnection, removeConnection, listConnections,
  startHeartbeat, stopHeartbeat,
} from "./adapter-manager.js";
export { parseAdapterConfig } from "./adapter-config.js";

// ─── Event System ──────────────────────────────────────────
export { emit, subscribe } from "./event-bus.js";

// ─── Wiring Initializers ───────────────────────────────────
export { initSigchldSubscriber } from "./signals/sigchld.js";
export { initOrphanReparentSubscriber, transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
export { initLifecycleManager } from "./lifecycle.js";

// ─── Task Session ───────────────────────────────────────────
export { startTaskSession } from "./task-session.js";

// ─── Session / Environment ─────────────────────────────────
export { attemptReconnects, resetReconnectState } from "./auto-reconnect.js";
export { pushToEnv } from "./token-push.js";
export { computeTaskStatus } from "./compute-task-status.js";

// ─── Knowledge ─────────────────────────────────────────────
export { isKnowledgeEnabled, initKnowledge } from "./knowledge-init.js";

// ─── Reconciliation / Scheduling ──────────────────────────
export { ReconciliationManager } from "./reconciliation-manager.js";
export type { ReconciliationPhase } from "./reconciliation-manager.js";
export { createCronPhase } from "./cron-phase.js";
export type { CronPhaseDeps } from "./cron-phase.js";
export { createOrphanPhase } from "./orphan-phase.js";
export type { OrphanPhaseDeps } from "./orphan-phase.js";
export { findFirstConnectedEnvironment } from "./find-connected-environment.js";
export { validateExpression, computeNextRunAt } from "./schedule-expression.js";
export { lifecycleCleanupPhase } from "./lifecycle-cleanup.js";

// ─── Version Check ────────────────────────────────────────
export { checkVersionStatus, clearVersionCache, type VersionStatus } from "./version-check.js";

// ─── Logger ────────────────────────────────────────────────
export { logger } from "./logger.js";

// ─── Trace Context ──────────────────────────────────────────
export { getTraceId, runWithTrace, isValidTraceId } from "./trace-context.js";

// ─── Utilities ─────────────────────────────────────────────
export { exec } from "./utils/exec.js";
export { detectLanIp } from "./utils/network.js";
