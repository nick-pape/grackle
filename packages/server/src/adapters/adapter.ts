import type { Client } from "@connectrpc/connect";
import type { sidecar } from "@grackle/common";

export type SidecarClient = Client<typeof sidecar.GrackleSidecar>;

export interface SidecarConnection {
  client: SidecarClient;
  envId: string;
  port: number;
}

export interface ProvisionEvent {
  stage: string;
  message: string;
  progress: number;
}

export interface EnvironmentAdapter {
  type: string;

  provision(envId: string, config: Record<string, unknown>, sidecarToken: string): AsyncGenerator<ProvisionEvent>;
  connect(envId: string, config: Record<string, unknown>, sidecarToken: string): Promise<SidecarConnection>;
  disconnect(envId: string): Promise<void>;
  stop(envId: string, config: Record<string, unknown>): Promise<void>;
  destroy(envId: string, config: Record<string, unknown>): Promise<void>;
  healthCheck(connection: SidecarConnection): Promise<boolean>;
}
