import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { sidecar, DEFAULT_SIDECAR_PORT } from "@grackle/common";
import type { EnvironmentAdapter, SidecarConnection, ProvisionEvent } from "./adapter.js";
import { exec } from "../utils/exec.js";
import { findFreePort } from "../utils/ports.js";

interface DockerConfig {
  image: string;
  containerName?: string;
  localPort?: number;
  volumes?: string[];
  env?: Record<string, string>;
}

const containerPorts = new Map<string, number>();

export class DockerAdapter implements EnvironmentAdapter {
  type = "docker";

  async *provision(envId: string, config: Record<string, unknown>): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerConfig;
    const image = cfg.image || "grackle-sidecar:latest";
    const containerName = cfg.containerName || `grackle-${envId}`;
    const localPort = cfg.localPort || await findFreePort();

    yield { stage: "creating", message: `Pulling image ${image}...`, progress: 0.1 };

    try {
      await exec("docker", ["pull", image], { timeout: 120_000 });
    } catch {
      yield { stage: "creating", message: "Pull failed, trying local image...", progress: 0.15 };
    }

    yield { stage: "creating", message: `Creating container ${containerName}...`, progress: 0.3 };

    const runArgs = [
      "run", "-d",
      "--name", containerName,
      "-p", `${localPort}:${DEFAULT_SIDECAR_PORT}`,
    ];

    if (cfg.volumes) {
      for (const vol of cfg.volumes) {
        runArgs.push("-v", vol);
      }
    }

    if (cfg.env) {
      for (const [key, val] of Object.entries(cfg.env)) {
        runArgs.push("-e", `${key}=${val}`);
      }
    }

    runArgs.push(image);

    // Check if container already exists
    try {
      await exec("docker", ["inspect", containerName]);
      yield { stage: "starting", message: "Container exists, starting...", progress: 0.4 };
      await exec("docker", ["start", containerName]);
    } catch {
      await exec("docker", runArgs);
    }

    containerPorts.set(envId, localPort);

    yield { stage: "starting", message: "Waiting for container...", progress: 0.5 };

    // Poll until running
    for (let i = 0; i < 30; i++) {
      try {
        const { stdout } = await exec("docker", ["inspect", "-f", "{{.State.Running}}", containerName]);
        if (stdout === "true") break;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }

    yield { stage: "connecting", message: `Connecting on port ${localPort}...`, progress: 0.8 };
  }

  async connect(envId: string, config: Record<string, unknown>): Promise<SidecarConnection> {
    const cfg = config as unknown as DockerConfig;
    const localPort = containerPorts.get(envId) || cfg.localPort || DEFAULT_SIDECAR_PORT;

    const transport = createGrpcTransport({
      baseUrl: `http://localhost:${localPort}`,
    });

    const client = createClient(sidecar.GrackleSidecar, transport);

    // Verify connection with a ping
    await client.ping({});

    return { client, envId, port: localPort };
  }

  async disconnect(envId: string): Promise<void> {
    containerPorts.delete(envId);
  }

  async stop(envId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerConfig;
    const containerName = cfg.containerName || `grackle-${envId}`;
    try {
      await exec("docker", ["stop", containerName]);
    } catch { /* may already be stopped */ }
    containerPorts.delete(envId);
  }

  async destroy(envId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerConfig;
    const containerName = cfg.containerName || `grackle-${envId}`;
    try {
      await exec("docker", ["rm", "-f", containerName]);
    } catch { /* may not exist */ }
    containerPorts.delete(envId);
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
