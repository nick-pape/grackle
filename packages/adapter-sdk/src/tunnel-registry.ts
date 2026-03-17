import type { RemoteTunnel } from "./tunnel.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";

/** State for an active tunnel pair (forward + optional reverse). */
export interface TunnelState {
  tunnel: RemoteTunnel;
  /** Optional reverse tunnel so remote agents can reach the host MCP endpoint. */
  reverseTunnel?: RemoteTunnel;
}

const tunnelMap: Map<string, TunnelState> = new Map<string, TunnelState>();

/** Register an active tunnel for an environment, closing any existing tunnel first. */
export function registerTunnel(
  environmentId: string,
  state: TunnelState,
  logger: AdapterLogger = defaultLogger,
): void {
  const existing = tunnelMap.get(environmentId);
  if (existing) {
    existing.tunnel.close().catch((err) => {
      logger.warn({ err, environmentId }, "Failed to close existing tunnel before registering new one");
    });
    if (existing.reverseTunnel) {
      existing.reverseTunnel.close().catch((err) => {
        logger.warn({ err, environmentId }, "Failed to close existing reverse tunnel before registering new one");
      });
    }
  }
  tunnelMap.set(environmentId, state);
}

/** Get the tunnel state for an environment. */
export function getTunnel(environmentId: string): TunnelState | undefined {
  return tunnelMap.get(environmentId);
}

/** Close and unregister the tunnel(s) for an environment. */
export async function closeTunnel(environmentId: string): Promise<void> {
  const state = tunnelMap.get(environmentId);
  if (state) {
    await state.tunnel.close();
    if (state.reverseTunnel) {
      await state.reverseTunnel.close();
    }
    tunnelMap.delete(environmentId);
  }
}

/** Close all active tunnels (called during server shutdown). */
export async function closeAllTunnels(logger: AdapterLogger = defaultLogger): Promise<void> {
  const ids = [...tunnelMap.keys()];
  for (const id of ids) {
    try {
      await closeTunnel(id);
    } catch (err) {
      logger.error({ environmentId: id, err }, "Failed to close tunnel during shutdown");
    }
  }
}
