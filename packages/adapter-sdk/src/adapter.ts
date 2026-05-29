import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";
import { FatalAdapterError } from "./fatal-error.js";
import type { IHostTransport } from "./host-transport.js";

/** An active connection to a PowerLine. */
export interface PowerLineConnection {
  environmentId: string;
  port: number;
  /**
   * Transport-agnostic host interface. Constructed when the connection is
   * established and used for all session-level operations.
   */
  transport: IHostTransport;
  /**
   * Send a liveness probe to the PowerLine. Resolves on success; rejects on
   * any transport-layer error.
   */
  ping(): Promise<void>;
  /**
   * Tear down the underlying transport (WebSocket + pending RPCs). Idempotent.
   * Adapters MUST call this from `disconnect()` to avoid socket leaks —
   * under HR8d the AHP transport is persistent and only closes here.
   */
  close(): Promise<void>;
}

/** Progress event emitted during environment provisioning. */
export interface ProvisionEvent {
  stage: string;
  message: string;
  progress: number;
}

/** Base configuration shared by all environment adapters. */
export interface BaseEnvironmentConfig {
  /** Override the default PowerLine port. */
  port?: number;
  /** Override the host to connect to. */
  host?: string;
}

/** Contract that all environment adapter backends must implement. */
export interface EnvironmentAdapter {
  type: string;

  /** Provision infrastructure and yield progress events. */
  provision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent>;
  /** Establish a gRPC connection to the PowerLine running in the environment. */
  connect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection>;
  /** Release resources associated with a connection without stopping the environment. */
  disconnect(environmentId: string): Promise<void>;
  /** Stop the environment's underlying compute (e.g. stop a Docker container). */
  stop(environmentId: string, config: Record<string, unknown>): Promise<void>;
  /** Permanently destroy the environment's underlying compute. */
  destroy(environmentId: string, config: Record<string, unknown>): Promise<void>;
  /** Return true if the PowerLine is reachable via ping. */
  healthCheck(connection: PowerLineConnection): Promise<boolean>;
  /** Attempt fast reconnect without re-bootstrapping. Throws if PowerLine cannot be restarted. */
  reconnect?(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent>;
}

/**
 * Try fast reconnect if the adapter supports it and the environment was
 * previously bootstrapped, falling back to full provision on any error.
 *
 * Yields {@link ProvisionEvent}s from whichever path runs, allowing callers
 * (gRPC streaming and WebSocket broadcast) to forward them uniformly.
 */
export async function* reconnectOrProvision(
  environmentId: string,
  adapter: EnvironmentAdapter,
  config: Record<string, unknown>,
  powerlineToken: string,
  bootstrapped: boolean,
  force: boolean = false,
  logger: AdapterLogger = defaultLogger,
): AsyncGenerator<ProvisionEvent> {
  let reconnected = false;
  if (!force && bootstrapped && adapter.reconnect) {
    try {
      yield* adapter.reconnect(environmentId, config, powerlineToken);
      reconnected = true;
    } catch (err) {
      if (err instanceof FatalAdapterError) {
        throw err;
      }
      logger.info({ environmentId, err }, "Reconnect failed, falling back to full provision");
    }
  }
  if (!reconnected) {
    yield* adapter.provision(environmentId, config, powerlineToken);
  }
}
