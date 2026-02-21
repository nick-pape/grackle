import { DEFAULT_SIDECAR_PORT } from "@grackle/common";
import type { EnvironmentAdapter, SidecarConnection, ProvisionEvent } from "./adapter.js";
import { createSidecarClient } from "./sidecar-transport.js";
import { exec } from "../utils/exec.js";
import { findFreePort } from "../utils/ports.js";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";

interface SshConfig {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

const tunnelProcesses = new Map<string, ChildProcess>();
const localPorts = new Map<string, number>();

function sshTarget(config: SshConfig): string {
  const user = config.user ? `${config.user}@` : "";
  return `${user}${config.host}`;
}

function sshArgs(config: SshConfig): string[] {
  const args: string[] = [];
  if (config.port) args.push("-p", String(config.port));
  if (config.identityFile) args.push("-i", config.identityFile);
  args.push("-o", "StrictHostKeyChecking=no");
  return args;
}

export class SshAdapter implements EnvironmentAdapter {
  type = "ssh";

  async *provision(envId: string, config: Record<string, unknown>, sidecarToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as SshConfig;
    const target = sshTarget(cfg);

    yield { stage: "bootstrapping", message: `Connecting to ${target}...`, progress: 0.2 };

    // Bootstrap: install node + sidecar if needed
    try {
      await exec("ssh", [
        ...sshArgs(cfg), target,
        "command -v node || (curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash - && sudo apt-get install -y nodejs); npm install -g @grackle/sidecar 2>/dev/null || true",
      ], { timeout: 180_000 });
    } catch (err) {
      yield { stage: "bootstrapping", message: `Bootstrap warning: ${err}`, progress: 0.3 };
    }

    yield { stage: "bootstrapping", message: "Starting sidecar...", progress: 0.4 };

    // Pass sidecar token as env var when starting the sidecar
    const tokenEnv = sidecarToken ? `GRACKLE_SIDECAR_TOKEN=${sidecarToken} ` : "";
    await exec("ssh", [
      ...sshArgs(cfg), target,
      `nohup ${tokenEnv}grackle-sidecar --port=${DEFAULT_SIDECAR_PORT} > /tmp/grackle-sidecar.log 2>&1 &`,
    ], { timeout: 30_000 });

    yield { stage: "tunneling", message: "Setting up reverse tunnel...", progress: 0.6 };

    const localPort = await findFreePort();
    localPorts.set(envId, localPort);

    // Reverse tunnel
    const tunnel = spawnProcess("ssh", [
      ...sshArgs(cfg),
      "-N",
      "-L", `${localPort}:localhost:${DEFAULT_SIDECAR_PORT}`,
      target,
    ], {
      stdio: "ignore",
      detached: true,
    });

    tunnel.unref();
    tunnelProcesses.set(envId, tunnel);

    await new Promise((r) => setTimeout(r, 2000));

    yield { stage: "connecting", message: `Connecting on port ${localPort}...`, progress: 0.8 };
  }

  async connect(envId: string, _config: Record<string, unknown>, sidecarToken: string): Promise<SidecarConnection> {
    const localPort = localPorts.get(envId);
    if (!localPort) throw new Error(`No port mapping for ${envId}`);

    const client = createSidecarClient(`http://localhost:${localPort}`, sidecarToken);
    await client.ping({});

    return { client, envId, port: localPort };
  }

  async disconnect(envId: string): Promise<void> {
    const tunnel = tunnelProcesses.get(envId);
    if (tunnel) {
      tunnel.kill();
      tunnelProcesses.delete(envId);
    }
    localPorts.delete(envId);
  }

  async stop(envId: string, _config: Record<string, unknown>): Promise<void> {
    await this.disconnect(envId);
  }

  async destroy(envId: string, _config: Record<string, unknown>): Promise<void> {
    await this.disconnect(envId);
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
