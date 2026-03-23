import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent, AdapterDependencies, AdapterLogger, ExecFunction, ExecResult } from "@grackle-ai/adapter-sdk";
import {
  createPowerLineClient,
  isDevMode,
  bootstrapPowerLine,
  startRemotePowerLine,
  findFreePort,
  exec as defaultExec,
  sleep as defaultSleep,
  defaultLogger,
  type RemoteExecutor,
} from "@grackle-ai/adapter-sdk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DOCKER_PULL_TIMEOUT_MS: number = 120_000;
/** Timeout for `docker build` when building the base image. */
const DOCKER_BUILD_TIMEOUT_MS: number = 300_000;
const GIT_CLONE_TIMEOUT_MS: number = 120_000;
const GIT_PULL_TIMEOUT_MS: number = 60_000;
const CONTAINER_POLL_DELAY_MS: number = 1_000;
const CONTAINER_POLL_MAX_ATTEMPTS: number = 30;
const CONNECT_RETRY_DELAY_MS: number = 1_500;
const CONNECT_MAX_RETRIES: number = 10;
const WORKSPACE_PATH: string = "/workspace";
/** Default image name used when no custom image is specified. */
const DEFAULT_IMAGE: string = "grackle-powerline:latest";
/** Timeout for commands executed inside the container. */
const DOCKER_EXEC_TIMEOUT_MS: number = 60_000;

/**
 * Docker network name for sibling containers. When set (typically via compose),
 * sibling containers join this network so the server can reach them directly
 * by container name instead of via host port mapping. Required for DooD setups
 * where the server itself runs in a container.
 */
const DOCKER_NETWORK: string | undefined = process.env.GRACKLE_DOCKER_NETWORK || undefined;

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

/** @internal Abstraction over command execution used by {@link DockerAdapter}. */
export interface DockerExecFactory {
  /** Execute a command and return its trimmed output. */
  exec(command: string, args: string[], options?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>;
}

/** Callable exec function type extracted from the factory. */
type LocalExecFunction = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

const containerPorts: Map<string, number> = new Map<string, number>();

// ─── Docker CLI Helpers ────────────────────────────────────

/** Pull a Docker image, suppressing errors if the image exists locally. */
async function pullImage(execFn: LocalExecFunction, image: string, logger: AdapterLogger): Promise<void> {
  try {
    await execFn("docker", ["pull", image], { timeout: DOCKER_PULL_TIMEOUT_MS });
  } catch {
    logger.debug({ image }, "Docker pull failed, trying local image");
  }
}

/** Start a new Docker container with the given arguments. Returns true if created; false if it already existed. */
async function createOrStartContainer(execFn: LocalExecFunction, containerName: string, runArgs: string[]): Promise<boolean> {
  try {
    await execFn("docker", ["inspect", containerName]);
    // Container exists — just start it
    await execFn("docker", ["start", containerName]);
    return false;
  } catch {
    // Container doesn't exist — create it
    await execFn("docker", runArgs);
    return true;
  }
}

/** Discover the host-mapped port of an existing container. */
async function discoverHostPort(execFn: LocalExecFunction, containerName: string, containerPort: number, fallback: number, logger: AdapterLogger): Promise<number> {
  try {
    const { stdout } = await execFn("docker", [
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
async function waitForContainerRunning(execFn: LocalExecFunction, sleepFn: (ms: number) => Promise<void>, containerName: string, logger: AdapterLogger): Promise<void> {
  for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
    try {
      const { stdout } = await execFn("docker", ["inspect", "-f", "{{.State.Running}}", containerName]);
      if (stdout === "true") {
        return;
      }
    } catch {
      logger.debug({ containerName, attempt: i }, "Container not yet running");
    }
    await sleepFn(CONTAINER_POLL_DELAY_MS);
  }
  throw new Error(`Container ${containerName} did not reach Running state after ${CONTAINER_POLL_MAX_ATTEMPTS} attempts`);
}

/** Clone or pull a git repo inside a container's workspace. */
async function ensureRepoInContainer(execFn: LocalExecFunction, containerName: string, repo: string, logger: AdapterLogger): Promise<void> {
  // Check if already cloned
  try {
    const { stdout } = await execFn("docker", [
      "exec", containerName, "bash", "-c", `ls ${WORKSPACE_PATH}/.git 2>/dev/null && echo exists`,
    ]);
    if (stdout.includes("exists")) {
      await execFn("docker", [
        "exec", "-w", WORKSPACE_PATH, containerName, "git", "pull", "--ff-only",
      ], { timeout: GIT_PULL_TIMEOUT_MS }).catch((err) => {
        logger.warn({ containerName, err }, "Git pull failed (may be detached HEAD)");
      });
      return;
    }
  } catch {
    // Not cloned — proceed to clone below
  }

  const ghToken = await getGitHubToken(execFn, logger);
  const cloneUrl = repo.startsWith("https://") ? repo : `https://github.com/${repo}.git`;

  if (ghToken) {
    await execFn("docker", [
      "exec", containerName, "git", "config", "--global",
      "credential.helper", `!f() { echo "username=x-access-token"; echo "password=${ghToken}"; }; f`,
    ]);
    await execFn("docker", [
      "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
    ], { timeout: GIT_CLONE_TIMEOUT_MS });
    await execFn("docker", [
      "exec", containerName, "git", "config", "--global", "--unset", "credential.helper",
    ]).catch((err) => {
      logger.warn({ err }, "Failed to unset credential helper");
    });
  } else {
    await execFn("docker", [
      "exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH,
    ], { timeout: GIT_CLONE_TIMEOUT_MS });
  }
}

/** Validate that a token contains only safe characters (alphanumeric, underscore, hyphen). */
const SAFE_TOKEN_PATTERN: RegExp = /^[a-zA-Z0-9_\-]+$/;

/** Get a GitHub token from the local `gh` CLI for private repo cloning. */
async function getGitHubToken(execFn: LocalExecFunction, logger: AdapterLogger): Promise<string | undefined> {
  try {
    const { stdout } = await execFn("gh", ["auth", "token"]);
    if (!stdout) {
      return undefined;
    }
    if (!SAFE_TOKEN_PATTERN.test(stdout)) {
      logger.warn({}, "GitHub token contains unexpected characters, skipping credential setup");
      return undefined;
    }
    return stdout;
  } catch {
    return undefined;
  }
}

/**
 * Build the base Docker image from the docker/Dockerfile.powerline.
 * Resolves the monorepo root from import.meta.dirname (dist/adapters → 4 levels up).
 */
async function buildBaseImage(execFn: LocalExecFunction, tag: string, logger: AdapterLogger): Promise<void> {
  const monorepoRoot = resolve(import.meta.dirname, "../../../../");
  logger.info({ tag, monorepoRoot }, "Building base PowerLine image");
  await execFn("docker", [
    "build",
    "-f", resolve(monorepoRoot, "docker/Dockerfile.powerline"),
    "-t", tag,
    monorepoRoot,
  ], { timeout: DOCKER_BUILD_TIMEOUT_MS });
}

// ─── Docker Executor ───────────────────────────────────────

/** Remote executor that runs commands inside a Docker container. */
class DockerExecutor implements RemoteExecutor {
  private containerName: string;
  private readonly execFn: LocalExecFunction;
  /** Cached resolved $HOME path. */
  private resolvedHome?: string;

  public constructor(containerName: string, execFn: LocalExecFunction) {
    this.containerName = containerName;
    this.execFn = execFn;
  }

  /** Execute a shell command inside the container and return stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const { stdout } = await this.execFn("docker", [
      "exec", this.containerName, "bash", "-c", command,
    ], { timeout: opts?.timeout || DOCKER_EXEC_TIMEOUT_MS });
    return stdout;
  }

  /** Copy a local file or directory into the container. */
  public async copyTo(localPath: string, remotePath: string): Promise<void> {
    // Resolve $HOME since docker cp doesn't expand shell variables
    let resolvedPath = remotePath;
    if (resolvedPath.includes("$HOME")) {
      if (!this.resolvedHome) {
        this.resolvedHome = (await this.exec("echo $HOME")).trim();
      }
      resolvedPath = resolvedPath.replace(/\$HOME/g, this.resolvedHome);
    }
    await this.execFn("docker", [
      "cp", localPath, `${this.containerName}:${resolvedPath}`,
    ], { timeout: DOCKER_EXEC_TIMEOUT_MS });
    // docker cp creates files owned by root; fix ownership so the container user can write
    await this.execFn("docker", [
      "exec", "-u", "root", this.containerName, "chown", "-R", "grackle:grackle", resolvedPath,
    ], { timeout: DOCKER_EXEC_TIMEOUT_MS });
  }
}

// ─── Docker Adapter ────────────────────────────────────────

/** Environment adapter that provisions and manages Docker containers running the PowerLine. */
export class DockerAdapter implements EnvironmentAdapter {
  public type: string = "docker";
  private readonly execFn: LocalExecFunction;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly logger: AdapterLogger;
  private readonly isGitHubProviderEnabled: () => boolean;

  public constructor(deps: AdapterDependencies = {}) {
    this.execFn = deps.exec ?? defaultExec;
    this.sleepFn = deps.sleep ?? defaultSleep;
    this.logger = deps.logger ?? defaultLogger;
    this.isGitHubProviderEnabled = deps.isGitHubProviderEnabled ?? (() => false);
  }

  public async *provision(environmentId: string, config: Record<string, unknown>, powerlineToken: string): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const image = cfg.image || DEFAULT_IMAGE;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    const localPort = cfg.localPort || await findFreePort();

    // Build or pull the base image
    const isDefault = image === DEFAULT_IMAGE;
    const dockerfilePath = resolve(import.meta.dirname, "../../../../docker/Dockerfile.powerline");
    if (isDevMode() && isDefault && existsSync(dockerfilePath)) {
      yield { stage: "creating", message: "Building base image...", progress: 0.05 };
      await buildBaseImage(this.execFn, image, this.logger);
    } else {
      yield { stage: "creating", message: `Pulling image ${image}...`, progress: 0.05 };
      await pullImage(this.execFn, image, this.logger);
    }

    yield { stage: "creating", message: `Creating container ${containerName}...`, progress: 0.10 };

    const runArgs = this.buildRunArgs(containerName, localPort, image, cfg, powerlineToken);

    const isNew = await createOrStartContainer(this.execFn, containerName, runArgs);
    let actualPort = localPort;
    if (!isNew) {
      yield { stage: "starting", message: "Container exists, starting...", progress: 0.12 };
      actualPort = await discoverHostPort(this.execFn, containerName, DEFAULT_POWERLINE_PORT, localPort, this.logger);
    }

    containerPorts.set(environmentId, actualPort);

    yield { stage: "starting", message: "Waiting for container...", progress: 0.15 };
    await waitForContainerRunning(this.execFn, this.sleepFn, containerName, this.logger);

    // Bootstrap PowerLine inside the container (same flow as SSH/Codespace).
    // Docker containers need host=0.0.0.0 because port mapping can't reach 127.0.0.1.
    const executor = new DockerExecutor(containerName, this.execFn);
    if (isNew) {
      yield* bootstrapPowerLine(executor, powerlineToken, {
        extraEnv: cfg.env,
        workingDirectory: WORKSPACE_PATH,
        host: "0.0.0.0",
        isGitHubProviderEnabled: this.isGitHubProviderEnabled,
        defaultRuntime: (config.defaultRuntime as string) || undefined,
      });
    } else {
      // Container already exists — just restart PowerLine with fresh token
      yield { stage: "reconnecting", message: "Restarting PowerLine...", progress: 0.60 };
      await startRemotePowerLine(executor, powerlineToken, {
        extraEnv: cfg.env,
        host: "0.0.0.0",
        probeFirst: true,
      });
    }

    if (cfg.repo) {
      yield { stage: "cloning", message: `Cloning ${cfg.repo}...`, progress: 0.80 };
      await ensureRepoInContainer(this.execFn, containerName, cfg.repo, this.logger);
      yield { stage: "cloning", message: "Repo ready", progress: 0.85 };
    }

    yield { stage: "connecting", message: `Connecting on port ${actualPort}...`, progress: 0.90 };
  }

  public async connect(environmentId: string, config: Record<string, unknown>, powerlineToken: string): Promise<PowerLineConnection> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    const localPort = containerPorts.get(environmentId) || cfg.localPort || DEFAULT_POWERLINE_PORT;

    // When on a shared Docker network, connect directly to the sibling container
    // by name on the default PowerLine port. Otherwise, use the mapped host port.
    const connectUrl = DOCKER_NETWORK
      ? `http://${containerName}:${DEFAULT_POWERLINE_PORT}`
      : `http://127.0.0.1:${localPort}`;
    const client = createPowerLineClient(connectUrl, powerlineToken);

    let lastErr: unknown;
    for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
      try {
        await client.ping({});
        return { client, environmentId, port: localPort };
      } catch (err) {
        lastErr = err;
        await this.sleepFn(CONNECT_RETRY_DELAY_MS);
      }
    }

    throw new Error(`Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  public async disconnect(environmentId: string): Promise<void> {
    containerPorts.delete(environmentId);
  }

  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    try {
      await this.execFn("docker", ["stop", containerName]);
    } catch (err) {
      this.logger.debug({ environmentId, err }, "Container may already be stopped");
    }
    containerPorts.delete(environmentId);
  }

  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    try {
      await this.execFn("docker", ["rm", "-f", containerName]);
    } catch (err) {
      this.logger.debug({ environmentId, err }, "Container may not exist");
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
  public buildRunArgs(
    containerName: string,
    localPort: number,
    image: string,
    cfg: DockerEnvironmentConfig,
    powerlineToken: string,
  ): string[] {
    const args = [
      "run", "-d",
      "--name", containerName,
    ];

    // When running inside a container (DooD), join the shared network so the
    // server can reach the sibling by container name. Otherwise, map the port
    // to the host for bare-metal setups.
    if (DOCKER_NETWORK) {
      args.push("--network", DOCKER_NETWORK);
    } else {
      args.push("-p", `127.0.0.1:${localPort}:${DEFAULT_POWERLINE_PORT}`);
    }

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

    // Pass PowerLine token for gRPC authentication (connectivity, not a credential).
    // All provider credentials are delivered via pushTokens() at task start.
    if (powerlineToken) {
      args.push("-e", `GRACKLE_POWERLINE_TOKEN=${powerlineToken}`);
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
