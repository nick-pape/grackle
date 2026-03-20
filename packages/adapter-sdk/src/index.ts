// ─── Logger ─────────────────────────────────────────────────
export type { AdapterLogger } from "./logger.js";
export { defaultLogger } from "./logger.js";

// ─── Proto Types ──────────────────────────────────────────────
export { powerline } from "@grackle-ai/common";

// ─── Core Adapter Types ─────────────────────────────────────
export type {
  PowerLineClient,
  PowerLineConnection,
  ProvisionEvent,
  BaseEnvironmentConfig,
  EnvironmentAdapter,
} from "./adapter.js";
export { reconnectOrProvision } from "./adapter.js";

// ─── Remote Executor ────────────────────────────────────────
export type { RemoteExecutor } from "./remote-executor.js";

// ─── Tunnels ────────────────────────────────────────────────
export type { RemoteTunnel } from "./tunnel.js";
export { ProcessTunnel } from "./tunnel.js";
export type { TunnelState } from "./tunnel-registry.js";
export { registerTunnel, getTunnel, closeTunnel, closeAllTunnels } from "./tunnel-registry.js";

// ─── Connect ────────────────────────────────────────────────
export { createPowerLineClient, connectThroughTunnel, waitForLocalPort } from "./connect.js";

// ─── Bootstrap ──────────────────────────────────────────────
export type { BootstrapOptions, StartRemotePowerLineOptions } from "./bootstrap.js";
export {
  bootstrapPowerLine,
  buildEnvFileContent,
  startRemotePowerLine,
  probeRemotePowerLine,
  writeRemoteEnvFile,
  buildRemoteKillCommand,
} from "./bootstrap.js";

// ─── Shared Operations ─────────────────────────────────────
export { remoteStop, remoteDestroy, remoteHealthCheck } from "./shared-operations.js";

// ─── Utilities ──────────────────────────────────────────────
export {
  sleep,
  findFreePort,
  isDevMode,
  getPackageVersion,
  shellEscape,
  REMOTE_POWERLINE_DIRECTORY,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
} from "./utils.js";
