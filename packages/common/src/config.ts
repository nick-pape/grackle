/**
 * Centralized Grackle configuration resolved from environment variables.
 *
 * Call {@link resolveGrackleConfig} once at startup and pass the result to
 * consumers. Partial resolvers ({@link resolveLogConfig},
 * {@link resolveNetworkConfig}) serve leaf packages that only need a slice.
 *
 * @module
 */

import {
  envPort,
  envString,
  envOptionalString,
  envInt,
  envFlag,
  envBool,
  type EnvSource,
} from "./env.js";
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_PORT,
  DEFAULT_MCP_PORT,
  DEFAULT_POWERLINE_PORT,
  DEFAULT_SANDBOX_PORT,
} from "./types.js";

// ─── Tuning defaults (mirrored from core, canonical values) ────

/** Default reconciliation tick interval (10 seconds). */
const DEFAULT_RECONCILIATION_TICK_MS: number = 10_000;

/** Default per-provider timeout for spawn-context resolution (1.5 seconds). */
const DEFAULT_SPAWN_CONTEXT_TIMEOUT_MS: number = 1_500;

// ─── Sub-config interfaces ─────────────────────────────────────

/** Pino-compatible log levels. */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/** Logging configuration shared across all packages. */
export interface LogConfig {
  /** Pino log level. */
  level: LogLevel;
  /** Whether `NODE_ENV` is `"production"`. */
  isProduction: boolean;
}

/** Network and port configuration. */
export interface NetworkConfig {
  /** gRPC server port (`GRACKLE_PORT`). */
  grpcPort: number;
  /** Web UI + WebSocket port (`GRACKLE_WEB_PORT`). */
  webPort: number;
  /** MCP server port (`GRACKLE_MCP_PORT`). */
  mcpPort: number;
  /** MCP Apps widget sandbox port (`GRACKLE_SANDBOX_PORT`). */
  sandboxPort: number;
  /** PowerLine gRPC port (`GRACKLE_POWERLINE_PORT`). */
  powerlinePort: number;
  /** Bind address (`GRACKLE_HOST`). */
  host: string;
  /** Canonical browser-facing origin (`GRACKLE_PUBLIC_URL`). */
  publicUrl?: string;
  /** Explicit MCP origin for broker-captured widgets (`GRACKLE_MCP_ORIGIN`). */
  mcpOrigin?: string;
  /** Explicit sandbox origin (`GRACKLE_SANDBOX_ORIGIN`). */
  sandboxOrigin?: string;
}

/** Filesystem path overrides. */
export interface PathConfig {
  /** Raw `GRACKLE_HOME` override (before joining with `.grackle`). */
  grackleHome?: string;
  /** Override agent working directory (`GRACKLE_WORKING_DIRECTORY`). */
  workingDirectory?: string;
  /** Worktree base path (`GRACKLE_WORKTREE_BASE`). */
  worktreeBase?: string;
  /** Override web asset directory (`GRACKLE_WEB_DIR`). */
  webDir?: string;
  /** MCP config file path (`GRACKLE_MCP_CONFIG`). */
  mcpConfig?: string;
}

/** Docker-related configuration. */
export interface DockerConfig {
  /** Container hostname for DooD mode (`GRACKLE_DOCKER_HOST`). */
  dockerHost?: string;
  /** Socat helper image (`GRACKLE_DOCKER_SOCAT_IMAGE`). */
  dockerSocatImage: string;
  /** Docker network name (`GRACKLE_DOCKER_NETWORK`). */
  dockerNetwork?: string;
}

/** Feature flags. */
export interface FeatureConfig {
  /** Skip auto-starting local PowerLine (`GRACKLE_SKIP_LOCAL_POWERLINE=1`). */
  skipLocalPowerline: boolean;
  /** Skip auto-starting root task on connect (`GRACKLE_SKIP_ROOT_AUTOSTART=1`). */
  skipRootAutostart: boolean;
  /** Skip task orchestration (`GRACKLE_SKIP_ORCHESTRATION=1`). */
  skipOrchestration: boolean;
  /** Skip task scheduling (`GRACKLE_SKIP_SCHEDULING=1`). */
  skipScheduling: boolean;
  /** Enable knowledge graph features (`GRACKLE_KNOWLEDGE_ENABLED`). */
  knowledgeEnabled: boolean;
}

/** Operational tuning knobs (resolve once at startup). */
export interface TuningConfig {
  /** Reconciliation loop interval in ms (`GRACKLE_RECONCILIATION_TICK_MS`). */
  reconciliationTickMs: number;
  /** Per-provider timeout for spawn-context resolution in ms (`GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS`). */
  kgSpawnContextTimeoutMs: number;
}

/** Complete Grackle configuration resolved from environment variables. */
export interface GrackleConfig {
  /** Network ports and bind address. */
  network: NetworkConfig;
  /** Filesystem path overrides. */
  paths: PathConfig;
  /** Docker-related configuration. */
  docker: DockerConfig;
  /** Feature flags. */
  features: FeatureConfig;
  /** Operational tuning. */
  tuning: TuningConfig;
  /** Logging. */
  log: LogConfig;
}

// ─── Resolvers ─────────────────────────────────────────────────

/** Resolve logging configuration from env vars. */
export function resolveLogConfig(env?: EnvSource): Readonly<LogConfig> {
  return Object.freeze({
    level: envString("LOG_LEVEL", "info", env) as LogLevel,
    isProduction: envString("NODE_ENV", "", env) === "production",
  });
}

/** Resolve network/port configuration from env vars. */
export function resolveNetworkConfig(env?: EnvSource): Readonly<NetworkConfig> {
  return Object.freeze({
    grpcPort: envPort("GRACKLE_PORT", DEFAULT_SERVER_PORT, env),
    webPort: envPort("GRACKLE_WEB_PORT", DEFAULT_WEB_PORT, env),
    mcpPort: envPort("GRACKLE_MCP_PORT", DEFAULT_MCP_PORT, env),
    sandboxPort: envPort("GRACKLE_SANDBOX_PORT", DEFAULT_SANDBOX_PORT, env),
    powerlinePort: envPort("GRACKLE_POWERLINE_PORT", DEFAULT_POWERLINE_PORT, env),
    host: envString("GRACKLE_HOST", "127.0.0.1", env),
    publicUrl: envOptionalString("GRACKLE_PUBLIC_URL", env),
    mcpOrigin: envOptionalString("GRACKLE_MCP_ORIGIN", env),
    sandboxOrigin: envOptionalString("GRACKLE_SANDBOX_ORIGIN", env),
  });
}

/** Resolve path configuration from env vars. */
export function resolvePathConfig(env?: EnvSource): Readonly<PathConfig> {
  return Object.freeze({
    grackleHome: envOptionalString("GRACKLE_HOME", env),
    workingDirectory: envOptionalString("GRACKLE_WORKING_DIRECTORY", env),
    worktreeBase: envOptionalString("GRACKLE_WORKTREE_BASE", env),
    webDir: envOptionalString("GRACKLE_WEB_DIR", env),
    mcpConfig: envOptionalString("GRACKLE_MCP_CONFIG", env),
  });
}

/** Resolve Docker configuration from env vars. */
export function resolveDockerConfig(env?: EnvSource): Readonly<DockerConfig> {
  return Object.freeze({
    dockerHost: envOptionalString("GRACKLE_DOCKER_HOST", env),
    dockerSocatImage: envString("GRACKLE_DOCKER_SOCAT_IMAGE", "alpine/socat", env),
    dockerNetwork: envOptionalString("GRACKLE_DOCKER_NETWORK", env),
  });
}

/** Resolve feature flags from env vars. */
export function resolveFeatureConfig(env?: EnvSource): Readonly<FeatureConfig> {
  return Object.freeze({
    skipLocalPowerline: envFlag("GRACKLE_SKIP_LOCAL_POWERLINE", env),
    skipRootAutostart: envFlag("GRACKLE_SKIP_ROOT_AUTOSTART", env),
    skipOrchestration: envFlag("GRACKLE_SKIP_ORCHESTRATION", env),
    skipScheduling: envFlag("GRACKLE_SKIP_SCHEDULING", env),
    knowledgeEnabled: envBool("GRACKLE_KNOWLEDGE_ENABLED", true, env),
  });
}

/** Resolve tuning configuration from env vars. */
export function resolveTuningConfig(env?: EnvSource): Readonly<TuningConfig> {
  return Object.freeze({
    reconciliationTickMs: envInt("GRACKLE_RECONCILIATION_TICK_MS", DEFAULT_RECONCILIATION_TICK_MS, {
      min: 1,
      env,
    }),
    kgSpawnContextTimeoutMs: envInt(
      "GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS",
      DEFAULT_SPAWN_CONTEXT_TIMEOUT_MS,
      { min: 1, env },
    ),
  });
}

/**
 * Resolve and validate all Grackle configuration from environment variables.
 * Returns a frozen config object. Call once at startup, pass to consumers.
 *
 * Does NOT include TLS or network-exposure validation — those are
 * server-specific concerns in `@grackle-ai/server`.
 */
export function resolveGrackleConfig(opts?: { env?: EnvSource }): Readonly<GrackleConfig> {
  const env = opts?.env;
  return Object.freeze({
    network: resolveNetworkConfig(env),
    paths: resolvePathConfig(env),
    docker: resolveDockerConfig(env),
    features: resolveFeatureConfig(env),
    tuning: resolveTuningConfig(env),
    log: resolveLogConfig(env),
  });
}
