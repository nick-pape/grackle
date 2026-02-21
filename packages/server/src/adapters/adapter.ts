import type { Client } from "@connectrpc/connect";
import type { sidecar } from "@grackle/common";

/** Type-safe ConnectRPC client for the sidecar gRPC service. */
export type SidecarClient = Client<typeof sidecar.GrackleSidecar>;

/** An active connection to a sidecar, including the gRPC client and port info. */
export interface SidecarConnection {
  client: SidecarClient;
  envId: string;
  port: number;
}

/** Progress event emitted during environment provisioning. */
export interface ProvisionEvent {
  stage: string;
  message: string;
  progress: number;
}

/** Contract that all environment adapter backends must implement. */
export interface EnvironmentAdapter {
  type: string;

  /** Provision infrastructure and yield progress events. */
  provision(envId: string, config: Record<string, unknown>, sidecarToken: string): AsyncGenerator<ProvisionEvent>;
  /** Establish a gRPC connection to the sidecar running in the environment. */
  connect(envId: string, config: Record<string, unknown>, sidecarToken: string): Promise<SidecarConnection>;
  /** Release resources associated with a connection without stopping the environment. */
  disconnect(envId: string): Promise<void>;
  /** Stop the environment's underlying compute (e.g. stop a Docker container). */
  stop(envId: string, config: Record<string, unknown>): Promise<void>;
  /** Permanently destroy the environment's underlying compute. */
  destroy(envId: string, config: Record<string, unknown>): Promise<void>;
  /** Return true if the sidecar is reachable via ping. */
  healthCheck(connection: SidecarConnection): Promise<boolean>;
}
