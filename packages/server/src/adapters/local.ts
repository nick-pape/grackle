import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { sidecar, DEFAULT_SIDECAR_PORT } from "@grackle/common";
import type { EnvironmentAdapter, SidecarConnection, ProvisionEvent } from "./adapter.js";

interface LocalConfig {
  port?: number;
  host?: string;
}

export class LocalAdapter implements EnvironmentAdapter {
  type = "local";

  async *provision(envId: string, config: Record<string, unknown>): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as LocalConfig;
    const port = cfg.port || DEFAULT_SIDECAR_PORT;
    const host = cfg.host || "localhost";

    yield { stage: "connecting", message: `Connecting to sidecar at ${host}:${port}...`, progress: 0.5 };

    // Just verify the sidecar is reachable
    const transport = createGrpcTransport({
      baseUrl: `http://${host}:${port}`,
    });
    const client = createClient(sidecar.GrackleSidecar, transport);

    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.ping({});
        yield { stage: "ready", message: "Connected to local sidecar", progress: 1 };
        return;
      } catch (err) {
        lastErr = err;
        yield { stage: "connecting", message: `Waiting for sidecar (attempt ${attempt + 1}/5)...`, progress: 0.5 + attempt * 0.1 };
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    yield { stage: "error", message: `Could not reach sidecar: ${lastErr}`, progress: 0 };
  }

  async connect(envId: string, config: Record<string, unknown>): Promise<SidecarConnection> {
    const cfg = config as unknown as LocalConfig;
    const port = cfg.port || DEFAULT_SIDECAR_PORT;
    const host = cfg.host || "localhost";

    const transport = createGrpcTransport({
      baseUrl: `http://${host}:${port}`,
    });

    const client = createClient(sidecar.GrackleSidecar, transport);
    await client.ping({});

    return { client, envId, port };
  }

  async disconnect(): Promise<void> {
    // Nothing to clean up for local connections
  }

  async stop(): Promise<void> {
    // Local sidecar lifecycle is managed externally
  }

  async destroy(): Promise<void> {
    // Local sidecar lifecycle is managed externally
  }

  async healthCheck(connection: SidecarConnection): Promise<boolean> {
    try {
      await connection.client.ping({});
      return true;
    } catch {
      return false;
    }
  }
}
