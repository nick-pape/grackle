import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { createPowerLineClient } from "./powerline-transport.js";
import { exec } from "../utils/exec.js";
import { findFreePort } from "../utils/ports.js";
import { sleep } from "../utils/sleep.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "../logger.js";

const DOCKER_PULL_TIMEOUT_MS: number = 120_000;
const GIT_CLONE_TIMEOUT_MS: number = 120_000;
const GIT_PULL_TIMEOUT_MS: number = 60_000;
const CONTAINER_POLL_DELAY_MS: number = 1_000;
const CONTAINER_POLL_MAX_ATTEMPTS: number = 30;
const CONNECT_RETRY_DELAY_MS: number = 1_500;
const CONNECT_MAX_RETRIES: number = 10;
const WORKSPACE_PATH: string = "/workspace";

/** Docker-specific environment configuration. */
export interface DockerEnvironmentConfig extends BaseEnvironmentConfig {
  image: string;
  containerName?: string;
  localPort?: number;
  volumes?: string[];
  env?: Record<string, string>;
  /** Git repo URL to clone into the container workspace. */
  repo?: string;
  /** Enable GPU passthrough (e.g. "all" for --gpus all). */
  gpus?: string;
}

const containerPorts: Map<string, number> = new Map<string, number>();

// ─── Docker CLI Helpers ────────────────────────────────────

/** Pull a Docker image, suppressing errors if the image exists locally. */
async function pullImage(image: string): Promise<boolean> {
  try {
    await exec("docker", ["pull", image], { timeout: DOCKER_PULL_TIMEOUT_MS });
    return true;
  } catch {
    logger.debug({ image }, "Docker pull failed, trying local image");
    return false;
  }
}

/** Start a new Docker container with the given arguments. Returns true if created; false if it already existed. */
async function createOrStartContainer(containerName: string, runArgs: string[]): Promise<boolean> {
  try {
    await exec("docker", ["inspect", containerName]);
    // Container exists — just start it
    await exec("docker", ["start", containerName]);
    return false;
  } catch {
    // Container doesn't exist — create it
    await exec("docker", runArgs);
    return true;
  }
}

/** Discover the host-mapped port of an existing container. */
async function discoverHostPort(containerName: string, containerPort: number, fallback: number): Promise<number> {
  try {
    const { stdout } = await exec("docker", [
      "inspect", "-f",
      `{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}`,
      containerName,
    ]);
    const parsed = parseInt(stdout, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  } catch {
    logger.debug({ containerName }, "Could not discover host port, using fallback");
  }
  return fallback;
}

/** Poll until a Docker container reaches the Running state. */
async function waitForContainerRunning(containerName: string): Promise<void> {
  for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
    try {
      const { stdout } = await exec("docker", ["inspect", "-f", "{{.State.Running}}", containerName]);
      if (stdout === "true") {
        return;
      }
    } catch {
      logger.debug({ containerName, attempt: i }, "Container not yet running");
    }
    await sleep(CONTAINER_POLL_DELAY_MS);
  }
}

/** Clone or pull a git repo inside a container's workspace. */
async function ensureRepoInContainer(containerName: string, repo: string): Promise<void> {
  // Check if already cloned
  try {
    const { stdout } = await exec("docker", [
      "exec", containerName, "bash", "-c", `ls ${WORKSPACE_PATH}/.git 2>/dev/null && echo exists`,
    ]);
    if (stdout.includes("exists")) {
      await exec("docker", [
        "exec", "-w", WORKSPACE_PATH, containerName, "git", "pull", "--ff-only",
      ], { timeout: GIT_PULL_TIMEOUT_MS }).catch((err) => {
        logger.warn({ containerName, err }, "Git pull failed (may be detached HEAD)");
      });
      return;
    }
  } catch {
    // Not cloned — proceed to clone below
  }

  const ghToken = await getGitHubToken();
  const cloneUrl = repo.startsWith("https://") ? repo : `https://github.com/${repo}.git`;

  if (ghToken) {
    await exec("docker", [
      "exec", containerName, "git", "config", "--global",
      "credential.helper", `!f() { echo "username=x-access-token"; echo "password=${ghToken}"; }; f`,
    ]);
    await exec("docker", [
      "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
    ], { timeout: GIT_CLONE_TIMEOUT_MS });
    await exec("docker", [
      "exec", containerName, "git", "config", "--global", "--unset", "credential.helper",
    ]).catch((err) => {
      logger.warn({ err }, "Failed to unset credential helper");
    });
  } else {
    await exec("docker", [
      "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
    ], { timeout: GIT_CLONE_TIMEOUT_MS });
  }
}

/** Validate that a token contains only safe characters (alphanumeric, underscore, hyphen). */
const SAFE_TOKEN_PATTERN: RegExp = /^[a-zA-Z0-9_\-]+$/;

/** Get a GitHub token from the local `gh` CLI for private repo cloning. */
async function getGitHubToken(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", ["auth", "token"]);
    if (!stdout) {
      return undefined;
    }
    if (!SAFE_TOKEN_PATTERN.test(stdout)) {
      logger.warn("GitHub token contains unexpected characters, skipping credential setup");
      return undefined;
    }
    return stdout;
  } catch {
    return undefined;
  }
}

// ─── Docker Adapter ────────────────────────────────────────

/** Environment adapter that provisions and manages Docker containers running the PowerLine. */
export class DockerAdapter implements EnvironmentAdapter {
  public type: string = "docker";

  public async *provision(environmentId: string, config: Record<string, unknown>, powerlineToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const image = cfg.image || "grackle-powerline:latest";
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    const localPort = cfg.localPort || await findFreePort();

    yield { stage: "creating", message: `Pulling image ${image}...`, progress: 0.1 };
    await pullImage(image);

    yield { stage: "creating", message: `Creating container ${containerName}...`, progress: 0.3 };

    const runArgs = this.buildRunArgs(containerName, localPort, image, cfg, powerlineToken);

    const isNew = await createOrStartContainer(containerName, runArgs);
    let actualPort = localPort;
    if (!isNew) {
      yield { stage: "starting", message: "Container exists, starting...", progress: 0.4 };
      actualPort = await discoverHostPort(containerName, DEFAULT_POWERLINE_PORT, localPort);
    }

    containerPorts.set(environmentId, actualPort);

    yield { stage: "starting", message: "Waiting for container...", progress: 0.5 };
    await waitForContainerRunning(containerName);

    if (cfg.repo) {
      yield { stage: "cloning", message: `Cloning ${cfg.repo}...`, progress: 0.6 };
      await ensureRepoInContainer(containerName, cfg.repo);
      yield { stage: "cloning", message: "Repo ready", progress: 0.75 };
    }

    yield { stage: "connecting", message: `Connecting on port ${actualPort}...`, progress: 0.8 };
  }

  public async connect(environmentId: string, config: Record<string, unknown>, powerlineToken: string): Promise<PowerLineConnection> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const localPort = containerPorts.get(environmentId) || cfg.localPort || DEFAULT_POWERLINE_PORT;

    const client = createPowerLineClient(`http://127.0.0.1:${localPort}`, powerlineToken);

    let lastErr: unknown;
    for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
      try {
        await client.ping({});
        return { client, environmentId, port: localPort };
      } catch (err) {
        lastErr = err;
        await sleep(CONNECT_RETRY_DELAY_MS);
      }
    }

    throw new Error(`Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastErr}`);
  }

  public async disconnect(environmentId: string): Promise<void> {
    containerPorts.delete(environmentId);
  }

  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    try {
      await exec("docker", ["stop", containerName]);
    } catch (err) {
      logger.debug({ environmentId, err }, "Container may already be stopped");
    }
    containerPorts.delete(environmentId);
  }

  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    try {
      await exec("docker", ["rm", "-f", containerName]);
    } catch (err) {
      logger.debug({ environmentId, err }, "Container may not exist");
    }
    containerPorts.delete(environmentId);
  }

  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    try {
      await connection.client.ping({});
      return true;
    } catch {
      return false;
    }
  }

  /** Build the `docker run` argument array from config and token. */
  private buildRunArgs(
    containerName: string,
    localPort: number,
    image: string,
    cfg: DockerEnvironmentConfig,
    powerlineToken: string,
  ): string[] {
    const args = [
      "run", "-d",
      "--name", containerName,
      "-p", `127.0.0.1:${localPort}:${DEFAULT_POWERLINE_PORT}`,
    ];

    if (cfg.volumes) {
      for (const vol of cfg.volumes) {
        args.push("-v", vol);
      }
    }

    if (cfg.env) {
      for (const [key, val] of Object.entries(cfg.env)) {
        args.push("-e", `${key}=${val}`);
      }
    }

    // Forward ANTHROPIC_API_KEY if set on host
    if (process.env.ANTHROPIC_API_KEY && !cfg.env?.ANTHROPIC_API_KEY) {
      args.push("-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    }

    // Forward GitHub tokens for Copilot runtime
    for (const tokenVar of ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN"]) {
      if (process.env[tokenVar] && !cfg.env?.[tokenVar]) {
        args.push("-e", `${tokenVar}=${process.env[tokenVar]}`);
      }
    }

    // Forward Copilot-specific configuration environment variables
    for (const envVar of ["COPILOT_CLI_URL", "COPILOT_CLI_PATH", "COPILOT_PROVIDER_CONFIG"]) {
      if (process.env[envVar] && !cfg.env?.[envVar]) {
        args.push("-e", `${envVar}=${process.env[envVar]}`);
      }
    }

    // Pass PowerLine token for authentication
    if (powerlineToken) {
      args.push("-e", `GRACKLE_POWERLINE_TOKEN=${powerlineToken}`);
    }

    // Mount Claude Code credentials for subscription auth
    const hostCredsPath = join(homedir(), ".claude", ".credentials.json");
    try {
      readFileSync(hostCredsPath); // verify it exists
      args.push("-v", `${hostCredsPath}:/home/grackle/.claude/.credentials.json:ro`);
    } catch {
      logger.debug("No Claude credentials file found, skipping mount");
    }

    // Chromium needs >64MB shared memory for rendering
    args.push("--shm-size=1gb");

    // GPU passthrough for accelerated inference (e.g. TTS, ML models)
    if (cfg.gpus) {
      args.push("--gpus", cfg.gpus);
    }

    args.push(image);
    return args;
  }
}
