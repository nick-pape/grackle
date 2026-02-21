import { DEFAULT_SIDECAR_PORT } from "@grackle/common";
import type { EnvironmentAdapter, SidecarConnection, ProvisionEvent } from "./adapter.js";
import { createSidecarClient } from "./sidecar-transport.js";
import { exec } from "../utils/exec.js";
import { findFreePort } from "../utils/ports.js";
import { spawn as spawnProcess, type ChildProcess } from "node:child_process";

interface CodespaceConfig {
  repo: string;
  machine?: string;
  codespaceName?: string;
}

const tunnelProcesses = new Map<string, ChildProcess>();
const localPorts = new Map<string, number>();

const BOOTSTRAP_SCRIPT = `
command -v node || (curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash - && sudo apt-get install -y nodejs)
npm install -g @grackle/sidecar 2>/dev/null || true
touch ~/.grackle-bootstrapped
`.trim();

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCodespace(name: string, maxAttempts = 60): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { stdout } = await exec("gh", ["cs", "list", "--json", "name,state", "-q", `.[] | select(.name=="${name}") | .state`]);
      if (stdout === "Available") return;
    } catch { /* retry */ }
    await sleep(2000);
  }
  throw new Error(`Codespace ${name} did not become available`);
}

export class CodespaceAdapter implements EnvironmentAdapter {
  type = "codespace";

  async *provision(envId: string, config: Record<string, unknown>, sidecarToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as CodespaceConfig;
    let codespaceName = cfg.codespaceName;

    if (!codespaceName) {
      yield { stage: "creating", message: `Creating codespace for ${cfg.repo}...`, progress: 0.1 };

      const machineArgs = cfg.machine ? ["--machine", cfg.machine] : [];
      const { stdout } = await exec("gh", [
        "cs", "create", "--repo", cfg.repo, ...machineArgs, "--status",
      ], { timeout: 180_000 });
      codespaceName = stdout.trim().split("\n").pop()?.trim();

      if (!codespaceName) {
        throw new Error("Failed to create codespace — no name returned");
      }
    }

    yield { stage: "starting", message: `Starting ${codespaceName}...`, progress: 0.2 };

    try {
      await exec("gh", ["cs", "start", "-c", codespaceName], { timeout: 120_000 });
    } catch { /* may already be running */ }

    yield { stage: "starting", message: "Waiting for codespace...", progress: 0.3 };
    await waitForCodespace(codespaceName);

    yield { stage: "bootstrapping", message: "Bootstrapping sidecar...", progress: 0.4 };

    try {
      await exec("gh", ["cs", "ssh", "-c", codespaceName, "--", "bash", "-c", BOOTSTRAP_SCRIPT], {
        timeout: 180_000,
      });
    } catch (err) {
      yield { stage: "bootstrapping", message: `Bootstrap warning: ${err}`, progress: 0.45 };
    }

    yield { stage: "bootstrapping", message: "Starting sidecar process...", progress: 0.5 };

    // Pass sidecar token as env var when starting the sidecar
    const tokenEnv = sidecarToken ? `GRACKLE_SIDECAR_TOKEN=${sidecarToken} ` : "";
    await exec("gh", [
      "cs", "ssh", "-c", codespaceName, "--",
      "bash", "-c", `nohup ${tokenEnv}grackle-sidecar --port=${DEFAULT_SIDECAR_PORT} > /tmp/grackle-sidecar.log 2>&1 &`,
    ], { timeout: 30_000 });

    yield { stage: "tunneling", message: "Establishing port forward...", progress: 0.6 };

    const localPort = await findFreePort();
    localPorts.set(envId, localPort);

    // Start port forwarding as a background process
    const tunnel = spawnProcess("gh", [
      "cs", "ports", "forward",
      `${DEFAULT_SIDECAR_PORT}:localhost:${localPort}`,
      "-c", codespaceName,
    ], {
      stdio: "ignore",
      detached: true,
    });

    tunnel.unref();
    tunnelProcesses.set(envId, tunnel);

    // Give tunnel time to establish
    await sleep(3000);

    yield { stage: "connecting", message: `Connecting on port ${localPort}...`, progress: 0.8 };
  }

  async connect(envId: string, _config: Record<string, unknown>, sidecarToken: string): Promise<SidecarConnection> {
    const localPort = localPorts.get(envId);
    if (!localPort) throw new Error(`No port mapping for ${envId}`);

    const client = createSidecarClient(`http://localhost:${localPort}`, sidecarToken);

    // Retry connection a few times (tunnel may still be establishing)
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.ping({});
        return { client, envId, port: localPort };
      } catch (err) {
        lastErr = err;
        await sleep(2000);
      }
    }
    throw new Error(`Failed to connect to codespace sidecar: ${lastErr}`);
  }

  async disconnect(envId: string): Promise<void> {
    const tunnel = tunnelProcesses.get(envId);
    if (tunnel) {
      tunnel.kill();
      tunnelProcesses.delete(envId);
    }
    localPorts.delete(envId);
  }

  async stop(envId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as CodespaceConfig;
    await this.disconnect(envId);
    if (cfg.codespaceName) {
      try {
        await exec("gh", ["cs", "stop", "-c", cfg.codespaceName]);
      } catch { /* may already be stopped */ }
    }
  }

  async destroy(envId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as CodespaceConfig;
    await this.disconnect(envId);
    if (cfg.codespaceName) {
      try {
        await exec("gh", ["cs", "delete", "-c", cfg.codespaceName, "-f"]);
      } catch { /* may not exist */ }
    }
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
