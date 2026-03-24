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
export { initWsSubscriber } from "./ws-broadcast.js";
export { initSigchldSubscriber } from "./signals/sigchld.js";
export { initLifecycleManager } from "./lifecycle.js";

// ─── WebSocket Bridge ──────────────────────────────────────
export { createWsBridge, startTaskSession } from "./ws-bridge.js";

// ─── Session / Environment ─────────────────────────────────
export { attemptReconnects, resetReconnectState } from "./auto-reconnect.js";
export { pushToEnv } from "./token-push.js";
export { computeTaskStatus } from "./compute-task-status.js";

// ─── Knowledge ─────────────────────────────────────────────
export { isKnowledgeEnabled, initKnowledge } from "./knowledge-init.js";

// ─── Logger ────────────────────────────────────────────────
export { logger } from "./logger.js";

// ─── Utilities ─────────────────────────────────────────────
export { exec } from "./utils/exec.js";
export { detectLanIp } from "./utils/network.js";
