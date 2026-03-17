/**
 * Re-exports from @grackle-ai/adapter-sdk with thin wrappers that inject the
 * server's pino logger and credential-provider check. Existing adapters
 * (SSH, Codespace, Docker, Local) continue importing from this module
 * unchanged.
 */
import {
  bootstrapPowerLine as sdkBootstrapPowerLine,
  startRemotePowerLine as sdkStartRemotePowerLine,
  connectThroughTunnel as sdkConnectThroughTunnel,
  remoteStop as sdkRemoteStop,
  remoteDestroy as sdkRemoteDestroy,
  type AdapterLogger,
  type StartRemotePowerLineOptions,
  type PowerLineConnection,
  type ProvisionEvent,
  type RemoteExecutor,
} from "@grackle-ai/adapter-sdk";
import { logger } from "../logger.js";
import { getCredentialProviders } from "../credential-providers.js";

// ─── Direct re-exports (no wrapper needed) ──────────────────

export type { RemoteExecutor, RemoteTunnel, TunnelState } from "@grackle-ai/adapter-sdk";
export {
  ProcessTunnel,
  registerTunnel,
  getTunnel,
  closeTunnel,
  closeAllTunnels,
  waitForLocalPort,
  findFreePort,
  isDevMode,
  probeRemotePowerLine,
  writeRemoteEnvFile,
  buildRemoteKillCommand,
  remoteHealthCheck,
  REMOTE_POWERLINE_DIRECTORY,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
} from "@grackle-ai/adapter-sdk";

// ─── Wrapped re-exports (inject server deps) ───────────────

/**
 * Bootstrap the PowerLine on a remote host via the given executor.
 * Injects the server's pino logger and credential provider check.
 */
export function bootstrapPowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  extraEnv?: Record<string, string>,
  workingDirectory?: string,
  host?: string,
): AsyncGenerator<ProvisionEvent> {
  return sdkBootstrapPowerLine(executor, powerlineToken, {
    extraEnv,
    workingDirectory,
    host,
    logger: logger as AdapterLogger,
    isGitHubProviderEnabled: () => getCredentialProviders().github !== "off",
  });
}

/**
 * Ensure the remote PowerLine process is running.
 * Injects the server's pino logger.
 */
export function startRemotePowerLine(
  executor: RemoteExecutor,
  powerlineToken: string,
  options: StartRemotePowerLineOptions = {},
): Promise<{ alreadyRunning: boolean }> {
  return sdkStartRemotePowerLine(executor, powerlineToken, {
    ...options,
    logger: logger as AdapterLogger,
  });
}

/**
 * Connect to a PowerLine through a local tunnel port.
 * Injects the server's pino logger.
 */
export function connectThroughTunnel(
  environmentId: string,
  localPort: number,
  powerlineToken: string,
): Promise<PowerLineConnection> {
  return sdkConnectThroughTunnel(environmentId, localPort, powerlineToken, logger as AdapterLogger);
}

/**
 * Stop the remote PowerLine process and close the tunnel.
 * Injects the server's pino logger.
 */
export function remoteStop(environmentId: string, executor: RemoteExecutor): Promise<void> {
  return sdkRemoteStop(environmentId, executor, logger as AdapterLogger);
}

/**
 * Stop the remote PowerLine, remove artifacts, and close the tunnel.
 * Injects the server's pino logger.
 */
export function remoteDestroy(environmentId: string, executor: RemoteExecutor): Promise<void> {
  return sdkRemoteDestroy(environmentId, executor, logger as AdapterLogger);
}
