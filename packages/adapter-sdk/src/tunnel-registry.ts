import type { RemoteTunnel } from "./tunnel.js";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";

/** State for an active tunnel pair (forward + optional reverse). */
export interface TunnelState {
  tunnel: RemoteTunnel;
  /** Optional reverse tunnel so remote agents can reach the host MCP endpoint. */
  reverseTunnel?: RemoteTunnel;
}

/** Per-instance registry of active tunnels, injected via {@link AdapterDependencies}. */
export class TunnelRegistry {
  private readonly tunnelMap: Map<string, TunnelState> = new Map<string, TunnelState>();

  /** Register an active tunnel for an environment, closing any existing tunnel first. */
  public register(
    environmentId: string,
    state: TunnelState,
    logger: AdapterLogger = defaultLogger,
  ): void {
    const existing = this.tunnelMap.get(environmentId);
    if (existing) {
      existing.tunnel.close().catch((err) => {
        logger.warn(
          { err, environmentId },
          "Failed to close existing tunnel before registering new one",
        );
      });
      if (existing.reverseTunnel) {
        existing.reverseTunnel.close().catch((err) => {
          logger.warn(
            { err, environmentId },
            "Failed to close existing reverse tunnel before registering new one",
          );
        });
      }
    }
    this.tunnelMap.set(environmentId, state);
  }

  /** Get the tunnel state for an environment. */
  public get(environmentId: string): TunnelState | undefined {
    return this.tunnelMap.get(environmentId);
  }

  /** Close and unregister the tunnel(s) for an environment. */
  public async close(environmentId: string): Promise<void> {
    const state = this.tunnelMap.get(environmentId);
    if (state) {
      await state.tunnel.close();
      if (state.reverseTunnel) {
        await state.reverseTunnel.close();
      }
      this.tunnelMap.delete(environmentId);
    }
  }

  /** Close all active tunnels (called during server shutdown). */
  public async closeAll(logger: AdapterLogger = defaultLogger): Promise<void> {
    const ids = [...this.tunnelMap.keys()];
    for (const id of ids) {
      try {
        await this.close(id);
      } catch (err) {
        logger.error({ environmentId: id, err }, "Failed to close tunnel during shutdown");
      }
    }
  }
}
