import { DEFAULT_SIDECAR_PORT } from "@grackle/common";
import type { EnvironmentAdapter, SidecarConnection, ProvisionEvent } from "./adapter.js";
import { createSidecarClient } from "./sidecar-transport.js";
import { exec } from "../utils/exec.js";
import { findFreePort } from "../utils/ports.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DOCKER_PULL_TIMEOUT_MS = 120_000;
const GIT_CLONE_TIMEOUT_MS = 120_000;
const GIT_PULL_TIMEOUT_MS = 60_000;
const CONTAINER_POLL_DELAY_MS = 1_000;
const CONTAINER_POLL_MAX_ATTEMPTS = 30;
const CONNECT_RETRY_DELAY_MS = 1_500;
const CONNECT_MAX_RETRIES = 10;
const WORKSPACE_PATH = "/workspace";

interface DockerConfig {
  image: string;
  containerName?: string;
  localPort?: number;
  volumes?: string[];
  env?: Record<string, string>;
  repo?: string; // Git repo URL to clone into WORKSPACE_PATH
}

const containerPorts = new Map<string, number>();

/** Environment adapter that provisions and manages Docker containers running the sidecar. */
export class DockerAdapter implements EnvironmentAdapter {
  type = "docker";

  async *provision(envId: string, config: Record<string, unknown>, sidecarToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerConfig;
    const image = cfg.image || "grackle-sidecar:latest";
    const containerName = cfg.containerName || `grackle-${envId}`;
    const localPort = cfg.localPort || await findFreePort();

    yield { stage: "creating", message: `Pulling image ${image}...`, progress: 0.1 };

    try {
      await exec("docker", ["pull", image], { timeout: DOCKER_PULL_TIMEOUT_MS });
    } catch {
      yield { stage: "creating", message: "Pull failed, trying local image...", progress: 0.15 };
    }

    yield { stage: "creating", message: `Creating container ${containerName}...`, progress: 0.3 };

    const runArgs = [
      "run", "-d",
      "--name", containerName,
      // Bind to 127.0.0.1 only — prevents network exposure
      "-p", `127.0.0.1:${localPort}:${DEFAULT_SIDECAR_PORT}`,
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

    // Forward ANTHROPIC_API_KEY if set on host
    if (process.env.ANTHROPIC_API_KEY && !cfg.env?.ANTHROPIC_API_KEY) {
      runArgs.push("-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    }

    // Pass sidecar token for authentication
    if (sidecarToken) {
      runArgs.push("-e", `GRACKLE_SIDECAR_TOKEN=${sidecarToken}`);
    }

    // Mount Claude Code credentials for subscription auth
    const hostCredsPath = join(homedir(), ".claude", ".credentials.json");
    try {
      readFileSync(hostCredsPath); // verify it exists
      runArgs.push("-v", `${hostCredsPath}:/home/grackle/.claude/.credentials.json:ro`);
    } catch { /* no credentials file */ }

    runArgs.push(image);

    // Check if container already exists
    let actualPort = localPort;
    try {
      await exec("docker", ["inspect", containerName]);
      yield { stage: "starting", message: "Container exists, starting...", progress: 0.4 };
      await exec("docker", ["start", containerName]);
      // Discover the actual host port from the existing container
      try {
        const { stdout } = await exec("docker", [
          "inspect", "-f",
          `{{(index (index .NetworkSettings.Ports "${DEFAULT_SIDECAR_PORT}/tcp") 0).HostPort}}`,
          containerName,
        ]);
        const parsed = parseInt(stdout, 10);
        if (!isNaN(parsed)) actualPort = parsed;
      } catch { /* fall back to localPort */ }
    } catch {
      await exec("docker", runArgs);
    }

    containerPorts.set(envId, actualPort);

    yield { stage: "starting", message: "Waiting for container...", progress: 0.5 };

    // Poll until running
    for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
      try {
        const { stdout } = await exec("docker", ["inspect", "-f", "{{.State.Running}}", containerName]);
        if (stdout === "true") break;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, CONTAINER_POLL_DELAY_MS));
    }

    // Clone repo if configured
    if (cfg.repo) {
      yield { stage: "cloning", message: `Cloning ${cfg.repo}...`, progress: 0.6 };
      // Check if already cloned
      try {
        const { stdout } = await exec("docker", [
          "exec", containerName, "bash", "-c", `ls ${WORKSPACE_PATH}/.git 2>/dev/null && echo exists`,
        ]);
        if (stdout.includes("exists")) {
          yield { stage: "cloning", message: "Repo already cloned, pulling latest...", progress: 0.65 };
          await exec("docker", [
            "exec", "-w", WORKSPACE_PATH, containerName, "git", "pull", "--ff-only",
          ], { timeout: GIT_PULL_TIMEOUT_MS }).catch(() => { /* pull may fail on detached HEAD etc */ });
        } else {
          throw new Error("not cloned");
        }
      } catch {
        // Clone fresh — use git credential helper with ephemeral token
        const ghToken = await getGitHubToken();
        const cloneUrl = cfg.repo.startsWith("https://")
          ? cfg.repo
          : `https://github.com/${cfg.repo}.git`;

        if (ghToken) {
          // Configure one-shot credential helper, clone, then remove the helper
          await exec("docker", [
            "exec", containerName, "git", "config", "--global",
            "credential.helper", `!f() { echo "username=x-access-token"; echo "password=${ghToken}"; }; f`,
          ]);
          await exec("docker", [
            "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
          ], { timeout: GIT_CLONE_TIMEOUT_MS });
          // Remove the credential helper so token isn't persisted
          await exec("docker", [
            "exec", containerName, "git", "config", "--global", "--unset", "credential.helper",
          ]).catch(() => {});
        } else {
          // No token — try cloning anyway (works for public repos)
          await exec("docker", [
            "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
          ], { timeout: GIT_CLONE_TIMEOUT_MS });
        }
      }
      yield { stage: "cloning", message: "Repo ready", progress: 0.75 };
    }

    yield { stage: "connecting", message: `Connecting on port ${actualPort}...`, progress: 0.8 };
  }

  async connect(envId: string, config: Record<string, unknown>, sidecarToken: string): Promise<SidecarConnection> {
    const cfg = config as unknown as DockerConfig;
    const localPort = containerPorts.get(envId) || cfg.localPort || DEFAULT_SIDECAR_PORT;

    const client = createSidecarClient(`http://127.0.0.1:${localPort}`, sidecarToken);

    // Retry ping — container may still be starting
    let lastErr: unknown;
    for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
      try {
        await client.ping({});
        return { client, envId, port: localPort };
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, CONNECT_RETRY_DELAY_MS));
      }
    }

    throw new Error(`Could not reach sidecar after ${CONNECT_MAX_RETRIES} attempts: ${lastErr}`);
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

/** Get a GitHub token from the local `gh` CLI for private repo cloning. */
async function getGitHubToken(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", ["auth", "token"]);
    return stdout || undefined;
  } catch {
    return undefined;
  }
}
