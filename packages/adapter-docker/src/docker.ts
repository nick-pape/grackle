import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import type {
  EnvironmentAdapter,
  BaseEnvironmentConfig,
  PowerLineConnection,
  ProvisionEvent,
  AdapterDependencies,
  AdapterLogger,
  ExecFunction,
  ExecResult,
} from "@grackle-ai/adapter-sdk";
import {
  createAhpHostTransport,
  isDevMode,
  bootstrapPowerLine,
  startRemotePowerLine,
  findFreePort,
  remoteStop,
  remoteDestroy,
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
 * Image for the connectivity sidecar used in attach mode when the host cannot
 * reach the attached container directly. Overridable for air-gapped registries.
 */
const SOCAT_IMAGE: string = process.env.GRACKLE_DOCKER_SOCAT_IMAGE || "alpine/socat";
/** Name prefix for the Grackle-owned socat sidecar created in attach mode. */
const ATTACH_SIDECAR_PREFIX: string = "grackle-attach-";

/**
 * Docker network name for sibling containers. When set (typically via compose),
 * sibling containers join this network so the server can reach them directly
 * by container name instead of via host port mapping. Required for DooD setups
 * where the server itself runs in a container.
 */
const DOCKER_NETWORK: string | undefined = process.env.GRACKLE_DOCKER_NETWORK || undefined;

/** Docker-specific environment configuration. */
export interface DockerEnvironmentConfig extends BaseEnvironmentConfig {
  /** Image to run in create mode (defaults to `grackle-powerline:latest`). Ignored in attach mode. */
  image?: string;
  containerName?: string;
  localPort?: number;
  volumes?: string[];
  env?: Record<string, string>;
  /** Git repo URL to clone into the container workspace. */
  repo?: string;
  /** Enable GPU passthrough (e.g. "all" for --gpus all). */
  gpus?: string;
  /**
   * Attach mode: name or ID of a pre-existing, externally-managed container to
   * attach to instead of creating one. When set, Grackle bootstraps PowerLine
   * inside the running container via `docker exec` and never creates, stops, or
   * removes it (see issue #1223). The `image`, `repo`, and `volumes` fields are
   * ignored in attach mode.
   */
  attach?: string;
}

/** @internal Abstraction over command execution used by {@link DockerAdapter}. */
export interface DockerExecFactory {
  /** Execute a command and return its trimmed output. */
  exec(
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

/** Callable exec function type extracted from the factory. */
type LocalExecFunction = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<ExecResult>;

const containerPorts: Map<string, number> = new Map<string, number>();

/** Resolved connectivity to an attached container's PowerLine, keyed by environment id. */
interface AttachConnection {
  /** Base URL the server uses to reach the attached container's PowerLine. */
  url: string;
  /** Host-reachable port behind {@link AttachConnection.url} (the sidecar's published port, or the default). */
  port: number;
  /** Name of the Grackle-owned socat sidecar, if one was created. */
  sidecarName?: string;
}

const attachConnections: Map<string, AttachConnection> = new Map<string, AttachConnection>();

// ─── Docker CLI Helpers ────────────────────────────────────

/** Return true if the named container currently exists and is running. */
async function inspectContainerRunning(
  execFn: LocalExecFunction,
  containerName: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFn("docker", [
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerName,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/** Discover the first network IP address of a container (empty string if none). */
async function inspectContainerIp(
  execFn: LocalExecFunction,
  containerName: string,
): Promise<string> {
  try {
    const { stdout } = await execFn("docker", [
      "inspect",
      "-f",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
      containerName,
    ]);
    return stdout.trim().split(/\s+/)[0] ?? "";
  } catch {
    return "";
  }
}

/** Discover the first network name a container is attached to (empty string if none). */
async function inspectContainerNetwork(
  execFn: LocalExecFunction,
  containerName: string,
): Promise<string> {
  try {
    const { stdout } = await execFn("docker", [
      "inspect",
      "-f",
      "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}",
      containerName,
    ]);
    return stdout.trim().split(/\s+/)[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Start a socat sidecar that bridges a host loopback port to the attached
 * container's PowerLine. The sidecar joins the target's network and forwards to
 * the target IP, publishing to the host — this works on both Docker Desktop and
 * native Linux. (Sharing the target's net namespace via `--network container:`
 * is not used because it conflicts with `-p` port publishing.)
 */
async function startSocatSidecar(
  execFn: LocalExecFunction,
  sidecarName: string,
  network: string,
  targetIp: string,
  hostPort: number,
): Promise<void> {
  await execFn(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      sidecarName,
      "--network",
      network,
      "-p",
      `127.0.0.1:${hostPort}:${DEFAULT_POWERLINE_PORT}`,
      SOCAT_IMAGE,
      `TCP-LISTEN:${DEFAULT_POWERLINE_PORT},fork,reuseaddr`,
      `TCP:${targetIp}:${DEFAULT_POWERLINE_PORT}`,
    ],
    { timeout: DOCKER_PULL_TIMEOUT_MS },
  );
}

/** Remove a Grackle-owned sidecar container, ignoring errors if it is absent. */
async function removeSidecar(
  execFn: LocalExecFunction,
  sidecarName: string,
  logger: AdapterLogger,
): Promise<void> {
  try {
    await execFn("docker", ["rm", "-f", sidecarName]);
  } catch (err) {
    logger.debug({ sidecarName, err }, "Sidecar may not exist");
  }
}

/** Pull a Docker image, suppressing errors if the image exists locally. */
async function pullImage(
  execFn: LocalExecFunction,
  image: string,
  logger: AdapterLogger,
): Promise<void> {
  try {
    await execFn("docker", ["pull", image], { timeout: DOCKER_PULL_TIMEOUT_MS });
  } catch {
    logger.debug({ image }, "Docker pull failed, trying local image");
  }
}

/** Start a new Docker container with the given arguments. Returns true if created; false if it already existed. */
async function createOrStartContainer(
  execFn: LocalExecFunction,
  containerName: string,
  runArgs: string[],
): Promise<boolean> {
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
async function discoverHostPort(
  execFn: LocalExecFunction,
  containerName: string,
  containerPort: number,
  fallback: number,
  logger: AdapterLogger,
): Promise<number> {
  try {
    const { stdout } = await execFn("docker", [
      "inspect",
      "-f",
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
async function waitForContainerRunning(
  execFn: LocalExecFunction,
  sleepFn: (ms: number) => Promise<void>,
  containerName: string,
  logger: AdapterLogger,
): Promise<void> {
  for (let i = 0; i < CONTAINER_POLL_MAX_ATTEMPTS; i++) {
    try {
      const { stdout } = await execFn("docker", [
        "inspect",
        "-f",
        "{{.State.Running}}",
        containerName,
      ]);
      if (stdout === "true") {
        return;
      }
    } catch {
      logger.debug({ containerName, attempt: i }, "Container not yet running");
    }
    await sleepFn(CONTAINER_POLL_DELAY_MS);
  }
  throw new Error(
    `Container ${containerName} did not reach Running state after ${CONTAINER_POLL_MAX_ATTEMPTS} attempts`,
  );
}

/** Clone or pull a git repo inside a container's workspace. */
async function ensureRepoInContainer(
  execFn: LocalExecFunction,
  containerName: string,
  repo: string,
  logger: AdapterLogger,
): Promise<void> {
  // Check if already cloned
  try {
    const { stdout } = await execFn("docker", [
      "exec",
      containerName,
      "bash",
      "-c",
      `ls ${WORKSPACE_PATH}/.git 2>/dev/null && echo exists`,
    ]);
    if (stdout.includes("exists")) {
      await execFn(
        "docker",
        ["exec", "-w", WORKSPACE_PATH, containerName, "git", "pull", "--ff-only"],
        { timeout: GIT_PULL_TIMEOUT_MS },
      ).catch((err) => {
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
      "exec",
      containerName,
      "git",
      "config",
      "--global",
      "credential.helper",
      `!f() { echo "username=x-access-token"; echo "password=${ghToken}"; }; f`,
    ]);
    await execFn("docker", ["exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH], {
      timeout: GIT_CLONE_TIMEOUT_MS,
    });
    await execFn("docker", [
      "exec",
      containerName,
      "git",
      "config",
      "--global",
      "--unset",
      "credential.helper",
    ]).catch((err) => {
      logger.warn({ err }, "Failed to unset credential helper");
    });
  } else {
    await execFn("docker", ["exec", containerName, "git", "clone", cloneUrl, WORKSPACE_PATH], {
      timeout: GIT_CLONE_TIMEOUT_MS,
    });
  }
}

/** Validate that a token contains only safe characters (alphanumeric, underscore, hyphen). */
const SAFE_TOKEN_PATTERN: RegExp = /^[a-zA-Z0-9_\-]+$/;

/** Get a GitHub token from the local `gh` CLI for private repo cloning. */
async function getGitHubToken(
  execFn: LocalExecFunction,
  logger: AdapterLogger,
): Promise<string | undefined> {
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
async function buildBaseImage(
  execFn: LocalExecFunction,
  tag: string,
  logger: AdapterLogger,
): Promise<void> {
  const monorepoRoot = resolve(import.meta.dirname, "../../../../");
  logger.info({ tag, monorepoRoot }, "Building base PowerLine image");
  await execFn(
    "docker",
    ["build", "-f", resolve(monorepoRoot, "docker/Dockerfile.powerline"), "-t", tag, monorepoRoot],
    { timeout: DOCKER_BUILD_TIMEOUT_MS },
  );
}

// ─── Docker Executor ───────────────────────────────────────

/** @internal Remote executor that runs commands inside a Docker container. */
export class DockerExecutor implements RemoteExecutor {
  private containerName: string;
  private readonly execFn: LocalExecFunction;
  /** Cached resolved $HOME path. */
  private resolvedHome?: string;
  /** Cached `uid:gid` of the container's default exec user. */
  private resolvedOwner?: string;

  public constructor(containerName: string, execFn: LocalExecFunction) {
    this.containerName = containerName;
    this.execFn = execFn;
  }

  /** Execute a shell command inside the container and return stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const { stdout } = await this.execFn(
      "docker",
      ["exec", this.containerName, "bash", "-c", command],
      { timeout: opts?.timeout || DOCKER_EXEC_TIMEOUT_MS },
    );
    return stdout;
  }

  /**
   * Resolve the `uid:gid` of the container's default exec user so copied files
   * can be owned by whoever PowerLine runs as. Using the container's actual user
   * (rather than a hardcoded `grackle`) lets attach mode target arbitrary,
   * externally-managed containers — not just images built with a `grackle` user.
   */
  private async resolveOwner(): Promise<string> {
    if (!this.resolvedOwner) {
      const uid = (await this.exec("id -u")).trim();
      const gid = (await this.exec("id -g")).trim();
      this.resolvedOwner = `${uid}:${gid}`;
    }
    return this.resolvedOwner;
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
    await this.execFn("docker", ["cp", localPath, `${this.containerName}:${resolvedPath}`], {
      timeout: DOCKER_EXEC_TIMEOUT_MS,
    });
    // docker cp creates files owned by root; fix ownership so the container's
    // default user (whoever PowerLine runs as) can write.
    const owner = await this.resolveOwner();
    await this.execFn(
      "docker",
      ["exec", "-u", "root", this.containerName, "chown", "-R", owner, resolvedPath],
      { timeout: DOCKER_EXEC_TIMEOUT_MS },
    );
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

  public async *provision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerEnvironmentConfig;

    // Attach mode: bootstrap PowerLine inside an existing, externally-managed
    // container. Grackle never creates the container here (issue #1223).
    if (cfg.attach) {
      yield* this.provisionAttach(environmentId, config, powerlineToken);
      return;
    }

    const image = cfg.image || DEFAULT_IMAGE;
    const containerName = cfg.containerName || `grackle-${environmentId}`;
    const localPort = cfg.localPort || (await findFreePort());

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

    yield { stage: "creating", message: `Creating container ${containerName}...`, progress: 0.1 };

    const runArgs = this.buildRunArgs(containerName, localPort, image, cfg, powerlineToken);

    const isNew = await createOrStartContainer(this.execFn, containerName, runArgs);
    let actualPort = localPort;
    if (!isNew) {
      yield { stage: "starting", message: "Container exists, starting...", progress: 0.12 };
      actualPort = await discoverHostPort(
        this.execFn,
        containerName,
        DEFAULT_POWERLINE_PORT,
        localPort,
        this.logger,
      );
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
      yield { stage: "reconnecting", message: "Restarting PowerLine...", progress: 0.6 };
      await startRemotePowerLine(executor, powerlineToken, {
        extraEnv: cfg.env,
        host: "0.0.0.0",
        probeFirst: true,
      });
    }

    if (cfg.repo) {
      yield { stage: "cloning", message: `Cloning ${cfg.repo}...`, progress: 0.8 };
      await ensureRepoInContainer(this.execFn, containerName, cfg.repo, this.logger);
      yield { stage: "cloning", message: "Repo ready", progress: 0.85 };
    }

    yield { stage: "connecting", message: `Connecting on port ${actualPort}...`, progress: 0.9 };
  }

  /**
   * Attach to a pre-existing container: verify it is running, bootstrap PowerLine
   * inside it via `docker exec`, then resolve connectivity. The container's
   * lifecycle stays owned by whatever created it.
   */
  private async *provisionAttach(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    const target = cfg.attach!;

    yield { stage: "connecting", message: `Attaching to container ${target}...`, progress: 0.05 };
    if (!(await inspectContainerRunning(this.execFn, target))) {
      throw new Error(
        `Cannot attach: container '${target}' is not running (or does not exist). Grackle never creates containers in attach mode.`,
      );
    }

    const executor = new DockerExecutor(target, this.execFn);
    yield* bootstrapPowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      host: "0.0.0.0",
      isGitHubProviderEnabled: this.isGitHubProviderEnabled,
      defaultRuntime: (config.defaultRuntime as string) || undefined,
    });

    yield { stage: "connecting", message: "Resolving connectivity...", progress: 0.85 };
    const conn = await this.resolveAttachConnectivity(environmentId, target, powerlineToken);
    attachConnections.set(environmentId, conn);
    yield { stage: "connecting", message: `Connecting via ${conn.url}...`, progress: 0.9 };
  }

  /**
   * Fast reconnect for attach mode: restart the in-container PowerLine without a
   * full bootstrap, then re-resolve connectivity. Throws for non-attach configs
   * so the server's reconnect-or-provision fallback runs a full create-mode provision.
   */
  public async *reconnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as DockerEnvironmentConfig;
    if (!cfg.attach) {
      throw new Error("Docker reconnect is only supported in attach mode");
    }
    const target = cfg.attach;

    yield { stage: "reconnecting", message: `Reconnecting to ${target}...`, progress: 0.1 };
    if (!(await inspectContainerRunning(this.execFn, target))) {
      throw new Error(`Cannot attach: container '${target}' is not running (or does not exist).`);
    }

    const executor = new DockerExecutor(target, this.execFn);
    await startRemotePowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      host: "0.0.0.0",
      probeFirst: true,
    });

    yield { stage: "reconnecting", message: "Resolving connectivity...", progress: 0.6 };
    const conn = await this.resolveAttachConnectivity(environmentId, target, powerlineToken);
    attachConnections.set(environmentId, conn);
    yield { stage: "reconnecting", message: `Reconnected via ${conn.url}`, progress: 0.9 };
  }

  /**
   * Resolve how the server reaches an attached container's PowerLine:
   * 1. shared Docker network (DooD/Coder) — by container name;
   * 2. the container's bridge IP, if reachable directly from the host;
   * 3. otherwise a Grackle-owned socat sidecar publishing a host loopback port.
   */
  private async resolveAttachConnectivity(
    environmentId: string,
    target: string,
    powerlineToken: string,
  ): Promise<AttachConnection> {
    if (DOCKER_NETWORK) {
      return { url: `http://${target}:${DEFAULT_POWERLINE_PORT}`, port: DEFAULT_POWERLINE_PORT };
    }

    const ip = await inspectContainerIp(this.execFn, target);
    if (ip) {
      const ipUrl = `http://${ip}:${DEFAULT_POWERLINE_PORT}`;
      if (await this.canReachPowerLine(ipUrl, powerlineToken)) {
        this.logger.info({ environmentId, target, ip }, "Attached container reachable by IP");
        return { url: ipUrl, port: DEFAULT_POWERLINE_PORT };
      }
    }

    if (!ip) {
      throw new Error(
        `Cannot determine the IP address of container '${target}' for attach connectivity`,
      );
    }

    const network = (await inspectContainerNetwork(this.execFn, target)) || "bridge";
    const sidecarName = `${ATTACH_SIDECAR_PREFIX}${environmentId}`;
    const hostPort = await findFreePort();
    // Clear any stale sidecar from a previous attach before starting a fresh one.
    await removeSidecar(this.execFn, sidecarName, this.logger);
    await startSocatSidecar(this.execFn, sidecarName, network, ip, hostPort);
    this.logger.info(
      { environmentId, target, network, hostPort },
      "Started socat sidecar for attach connectivity",
    );
    return { url: `http://127.0.0.1:${hostPort}`, port: hostPort, sidecarName };
  }

  /** Probe whether a PowerLine URL answers a ping (used to test direct host→container reachability). */
  private async canReachPowerLine(url: string, powerlineToken: string): Promise<boolean> {
    try {
      const { socket } = await createAhpHostTransport(url, powerlineToken, "reachability-probe");
      await socket.request("ping", { channel: "ahp-root://" });
      await socket.close();
      return true;
    } catch {
      return false;
    }
  }

  public async connect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    const cfg = config as unknown as DockerEnvironmentConfig;

    let connectUrl: string;
    let port: number;
    if (cfg.attach) {
      let conn = attachConnections.get(environmentId);
      if (!conn) {
        // No cached connectivity (e.g. after a server restart). Re-resolve it —
        // recreating the socat sidecar if needed — instead of failing the connect.
        this.logger.info(
          { environmentId, target: cfg.attach },
          "No cached attach connectivity; re-resolving",
        );
        conn = await this.resolveAttachConnectivity(environmentId, cfg.attach, powerlineToken);
        attachConnections.set(environmentId, conn);
      }
      connectUrl = conn.url;
      port = conn.port;
    } else {
      const containerName = cfg.containerName || `grackle-${environmentId}`;
      const localPort =
        containerPorts.get(environmentId) || cfg.localPort || DEFAULT_POWERLINE_PORT;
      port = localPort;
      // When on a shared Docker network, connect directly to the sibling container
      // by name on the default PowerLine port. Otherwise, use the mapped host port.
      connectUrl = DOCKER_NETWORK
        ? `ws://${containerName}:${DEFAULT_POWERLINE_PORT}`
        : `ws://127.0.0.1:${localPort}`;
    }
    // For attach-mode connectUrl is http:// from resolveAttachConnectivity;
    // createAhpHostTransport normalizes http(s) to ws(s).
    let lastErr: unknown;
    for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
      try {
        const { transport, socket } = await createAhpHostTransport(
          connectUrl,
          powerlineToken,
          environmentId,
        );
        await socket.request("ping", { channel: "ahp-root://" });
        return {
          environmentId,
          port,
          transport,
          ping: async () => {
            await socket.request("ping", { channel: "ahp-root://" });
          },
        };
      } catch (err) {
        lastErr = err;
        await this.sleepFn(CONNECT_RETRY_DELAY_MS);
      }
    }

    throw new Error(
      `Could not reach PowerLine after ${CONNECT_MAX_RETRIES} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  public async disconnect(environmentId: string): Promise<void> {
    const conn = attachConnections.get(environmentId);
    if (conn?.sidecarName) {
      await removeSidecar(this.execFn, conn.sidecarName, this.logger);
    }
    attachConnections.delete(environmentId);
    containerPorts.delete(environmentId);
  }

  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as DockerEnvironmentConfig;

    // Attach mode: never stop the externally-managed container. Stop the
    // in-container PowerLine and remove our connectivity sidecar only.
    if (cfg.attach) {
      await remoteStop(environmentId, new DockerExecutor(cfg.attach, this.execFn), this.logger);
      await removeSidecar(this.execFn, `${ATTACH_SIDECAR_PREFIX}${environmentId}`, this.logger);
      attachConnections.delete(environmentId);
      containerPorts.delete(environmentId);
      return;
    }

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

    // Attach mode: never remove the externally-managed container. Stop the
    // in-container PowerLine, clean up its artifacts, and remove our sidecar.
    if (cfg.attach) {
      await remoteDestroy(environmentId, new DockerExecutor(cfg.attach, this.execFn), this.logger);
      await removeSidecar(this.execFn, `${ATTACH_SIDECAR_PREFIX}${environmentId}`, this.logger);
      attachConnections.delete(environmentId);
      containerPorts.delete(environmentId);
      return;
    }

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
      await connection.ping();
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
    const args = ["run", "-d", "--name", containerName];

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
