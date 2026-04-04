import type { PowerLineConnection } from "./adapter.js";
import type { RemoteExecutor } from "./remote-executor.js";
import { closeTunnel, getTunnel } from "./tunnel-registry.js";
import { buildRemoteKillCommand } from "./bootstrap.js";
import { REMOTE_POWERLINE_DIRECTORY } from "./utils.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";

/**
 * Stop the remote PowerLine process and close the tunnel.
 * Shared by SSH and Codespace adapters.
 */
export async function remoteStop(
  environmentId: string,
  executor: RemoteExecutor,
  logger: AdapterLogger = defaultLogger,
): Promise<void> {
  try {
    await executor.exec(buildRemoteKillCommand());
  } catch (err) {
    logger.debug({ environmentId, err }, "Failed to kill remote PowerLine (may already be stopped)");
  }
  await closeTunnel(environmentId);
}

/**
 * Stop the remote PowerLine, remove artifacts, and close the tunnel.
 * Shared by SSH and Codespace adapters.
 */
export async function remoteDestroy(
  environmentId: string,
  executor: RemoteExecutor,
  logger: AdapterLogger = defaultLogger,
): Promise<void> {
  try {
    await executor.exec(
      `${buildRemoteKillCommand()}; `
      + 'CRED="$HOME/.claude/.credentials.json"; '
      + `if [ -L "$CRED" ]; then case "$(readlink "$CRED" 2>/dev/null)" in ${REMOTE_POWERLINE_DIRECTORY}/*) rm -f "$CRED";; esac; fi; `
      + `HELPER="$(git config --global credential.helper 2>/dev/null || true)"; `
      + `case "$HELPER" in ${REMOTE_POWERLINE_DIRECTORY}/*) git config --global --unset credential.helper 2>/dev/null || true;; esac; `
      + `rm -rf ${REMOTE_POWERLINE_DIRECTORY}`,
    );
  } catch (err) {
    logger.debug({ environmentId, err }, "Failed to clean up remote PowerLine artifacts");
  }
  await closeTunnel(environmentId);
}

/** Check that the tunnel is alive and the PowerLine responds to a ping. */
export async function remoteHealthCheck(connection: PowerLineConnection): Promise<boolean> {
  const state = getTunnel(connection.environmentId);
  if (!state?.tunnel.isAlive()) {
    return false;
  }
  // Also check the reverse tunnel (agent → host MCP) if one was registered.
  // A dead reverse tunnel means spawned agents cannot make MCP tool calls even
  // though the forward tunnel and PowerLine gRPC ping still succeed.
  if (state.reverseTunnel && !state.reverseTunnel.isAlive()) {
    return false;
  }
  try {
    await connection.client.ping({});
    return true;
  } catch {
    return false;
  }
}
