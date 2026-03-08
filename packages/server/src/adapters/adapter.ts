import type { Client } from "@connectrpc/connect";
import type { powerline } from "@grackle-ai/common";

/** Type-safe ConnectRPC client for the PowerLine gRPC service. */
export type PowerLineClient = Client<typeof powerline.GracklePowerLine>;

/** An active connection to a PowerLine, including the gRPC client and port info. */
export interface PowerLineConnection {
  client: PowerLineClient;
  environmentId: string;
  port: number;
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
  provision(environmentId: string, config: Record<string, unknown>, powerlineToken: string): AsyncGenerator<ProvisionEvent>;
  /** Establish a gRPC connection to the PowerLine running in the environment. */
  connect(environmentId: string, config: Record<string, unknown>, powerlineToken: string): Promise<PowerLineConnection>;
  /** Release resources associated with a connection without stopping the environment. */
  disconnect(environmentId: string): Promise<void>;
  /** Stop the environment's underlying compute (e.g. stop a Docker container). */
  stop(environmentId: string, config: Record<string, unknown>): Promise<void>;
  /** Permanently destroy the environment's underlying compute. */
  destroy(environmentId: string, config: Record<string, unknown>): Promise<void>;
  /** Return true if the PowerLine is reachable via ping. */
  healthCheck(connection: PowerLineConnection): Promise<boolean>;
}
