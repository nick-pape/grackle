// ─── Logger ─────────────────────────────────────────────────
export type { AdapterLogger } from "./logger.js";

// ─── Fatal Error ─────────────────────────────────────────────
export { FatalAdapterError } from "./fatal-error.js";
export { defaultLogger } from "./logger.js";

// ─── Core Adapter Types ─────────────────────────────────────
export type {
  PowerLineConnection,
  ProvisionEvent,
  BaseEnvironmentConfig,
  EnvironmentAdapter,
} from "./adapter.js";
export { reconnectOrProvision } from "./adapter.js";

// ─── Remote Executor ────────────────────────────────────────
export type { RemoteExecutor } from "./remote-executor.js";

// ─── Tunnels ────────────────────────────────────────────────
export type { RemoteTunnel, TunnelProcessFactory, TunnelPortProbe } from "./tunnel.js";
export { ProcessTunnel } from "./tunnel.js";
export type { TunnelState } from "./tunnel-registry.js";
export { registerTunnel, getTunnel, closeTunnel, closeAllTunnels } from "./tunnel-registry.js";

// ─── Connect ────────────────────────────────────────────────
export type { PortProber, WaitForLocalPortOptions } from "./connect.js";
export {
  createAhpHostTransport,
  connectThroughTunnel,
  waitForLocalPort,
  TCP_PORT_PROBER,
} from "./connect.js";

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

// ─── Exec ────────────────────────────────────────────────────
export type { ExecResult } from "./exec.js";
export { exec } from "./exec.js";

// ─── Adapter Dependencies ───────────────────────────────────
export type { ExecFunction, AdapterDependencies } from "./adapter-dependencies.js";

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

// ─── Host Transport (AHP HR8c/HR8d) ─────────────────────────
// Re-export AgentEventFields from common so consumers of `ServerActionEnvelope`
// (which references it) don't have to import @grackle-ai/common just for the
// type and api-extractor doesn't flag `ae-forgotten-export`.
export type { AgentEventFields } from "@grackle-ai/common";
export type {
  IHostTransport,
  ServerActionEnvelope,
  CreateSessionParams,
  CreateSessionResult,
  ReanimateParams,
  AuthenticateParams,
  AuthenticateTokenItem,
  HostSessionInfo,
} from "./host-transport.js";
export { AhpHostTransport, bindNotificationHandler } from "./ahp-host-transport.js";
