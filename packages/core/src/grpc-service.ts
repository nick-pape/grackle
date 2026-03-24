import { ConnectError, Code, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import type { EnvironmentRow, SessionRow } from "@grackle-ai/database";
import { envRegistry, sessionStore, tokenStore, workspaceStore, taskStore, findingStore, personaStore, settingsStore, isAllowedSettingKey, credentialProviders, grackleHome, safeParseJsonArray, slugify } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import * as streamHub from "./stream-hub.js";
import * as tokenPush from "./token-push.js";
import { parseAdapterConfig } from "./adapter-config.js";
import { emit } from "./event-bus.js";
import { processEventStream } from "./event-processor.js";
import * as processorRegistry from "./processor-registry.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { clearReconnectState } from "./auto-reconnect.js";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_WEB_PORT,
  DEFAULT_MCP_PORT,
  MAX_TASK_DEPTH,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  END_REASON,
  TASK_STATUS,
  ROOT_TASK_ID,
  taskStatusToEnum,
  taskStatusToString,
  workspaceStatusToEnum,
  claudeProviderModeToEnum,
  providerToggleToEnum,
  eventTypeToEnum,
} from "@grackle-ai/common";
import * as logWriter from "./log-writer.js";
import { resolvePersona, fetchOrchestratorContext, SystemPromptBuilder, buildTaskPrompt } from "@grackle-ai/prompt";
import { createScopedToken, loadOrCreateApiKey, generatePairingCode } from "@grackle-ai/auth";
import { computeTaskStatus } from "./compute-task-status.js";
import { logger } from "./logger.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { getKnowledgeEmbedder, isKnowledgeEnabled } from "./knowledge-init.js";
import {
  knowledgeSearch,
  getNode as getKnowledgeNodeById,
  expandNode,
  createNativeNode,
  ingest,
  createPassThroughChunker,
  listRecentNodes,
  type KnowledgeNode,
  type KnowledgeEdge,
  type SearchResult,
  type Embedder,
  type EdgeType,
} from "@grackle-ai/knowledge";
import { exec } from "./utils/exec.js";
import { formatGhError } from "./utils/format-gh-error.js";
import { detectLanIp } from "./utils/network.js";
import * as streamRegistry from "./stream-registry.js";
import * as pipeDelivery from "./pipe-delivery.js";
import { ensureAsyncDeliveryListener } from "./pipe-delivery.js";
import { cleanupLifecycleStream, ensureLifecycleStream } from "./lifecycle.js";

/** Valid pipe mode values for SpawnRequest and StartTaskRequest. */
const VALID_PIPE_MODES: ReadonlySet<string> = new Set(["", "sync", "async", "detach"]);

/** Timeout for `gh codespace list` in milliseconds. */
const GH_CODESPACE_LIST_TIMEOUT_MS: number = 30_000;

/** Timeout for `gh codespace create` in milliseconds. */
const GH_CODESPACE_CREATE_TIMEOUT_MS: number = 300_000;

/** Maximum number of codespaces returned by `gh codespace list`. */
const GH_CODESPACE_LIST_LIMIT: number = 50;

/** Validate pipe mode and parentSessionId. Throws ConnectError on invalid input. */
function validatePipeInputs(pipe: string, parentSessionId: string): void {
  if (pipe && !VALID_PIPE_MODES.has(pipe)) {
    throw new ConnectError(
      `Invalid pipe mode: "${pipe}". Must be "sync", "async", "detach", or empty.`,
      Code.InvalidArgument,
    );
  }
  if (pipe && pipe !== "detach" && !parentSessionId) {
    throw new ConnectError(
      `Pipe mode "${pipe}" requires parent_session_id`,
      Code.InvalidArgument,
    );
  }
}

/**
 * Map a bind host to a dialable URL host. Wildcard addresses become loopback,
 * unless GRACKLE_DOCKER_HOST is set (DooD mode) — in that case, use that value
 * so sibling containers can reach the server by container name.
 */
export function toDialableHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    const dockerHost = process.env.GRACKLE_DOCKER_HOST;
    if (dockerHost) {
      if (dockerHost.startsWith("[") && dockerHost.endsWith("]")) {
        return dockerHost;
      }
      return dockerHost.includes(":") ? `[${dockerHost}]` : dockerHost;
    }
    return bindHost === "::" ? "[::1]" : "127.0.0.1";
  }
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

function envRowToProto(row: EnvironmentRow): grackle.Environment {
  return create(grackle.EnvironmentSchema, {
    id: row.id,
    displayName: row.displayName,
    adapterType: row.adapterType,
    adapterConfig: row.adapterConfig,
    bootstrapped: row.bootstrapped,
    status: row.status,
    lastSeen: row.lastSeen || "",
    envInfo: row.envInfo || "",
    createdAt: row.createdAt,
  });
}

function sessionRowToProto(row: SessionRow): grackle.Session {
  return create(grackle.SessionSchema, {
    id: row.id,
    environmentId: row.environmentId,
    runtime: row.runtime,
    runtimeSessionId: row.runtimeSessionId ?? "",
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    logPath: row.logPath ?? "",
    turns: row.turns,
    startedAt: row.startedAt,
    suspendedAt: row.suspendedAt ?? "",
    endedAt: row.endedAt ?? "",
    error: row.error ?? "",
    taskId: row.taskId,
    personaId: row.personaId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    endReason: row.endReason ?? "",
  });
}

function workspaceRowToProto(row: workspaceStore.WorkspaceRow): grackle.Workspace {
  return create(grackle.WorkspaceSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repoUrl,
    environmentId: row.environmentId,
    status: workspaceStatusToEnum(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    useWorktrees: row.useWorktrees,
    worktreeBasePath: row.worktreeBasePath,
    defaultPersonaId: row.defaultPersonaId,
  });
}

function taskRowToProto(
  row: taskStore.TaskRow,
  childIds?: string[],
  computedStatus?: string,
  latestSessionId?: string,
): grackle.Task {
  return create(grackle.TaskSchema, {
    id: row.id,
    workspaceId: row.workspaceId ?? undefined,
    title: row.title,
    description: row.description,
    status: taskStatusToEnum(computedStatus ?? row.status),
    branch: row.branch,
    latestSessionId: latestSessionId ?? "",
    dependsOn: safeParseJsonArray(row.dependsOn),
    startedAt: row.startedAt ?? "",
    completedAt: row.completedAt ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sortOrder: row.sortOrder,
    parentTaskId: row.parentTaskId,
    depth: row.depth,
    childTaskIds: childIds ?? taskStore.getChildren(row.id).map((c) => c.id),
    canDecompose: row.canDecompose,
    defaultPersonaId: row.defaultPersonaId,
  });
}

function findingRowToProto(row: findingStore.FindingRow): grackle.Finding {
  return create(grackle.FindingSchema, {
    ...row,
    tags: safeParseJsonArray(row.tags),
  });
}

/** Safely parse a JSON string, returning the fallback value on failure. */
function safeParseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Convert a persona database row to a Persona proto message. */
function personaRowToProto(row: personaStore.PersonaRow): grackle.Persona {
  const toolConfig = safeParseJson<{
    allowedTools?: string[];
    disallowedTools?: string[];
  }>(row.toolConfig, {});
  const mcpServers = safeParseJson<
    { name: string; command: string; args?: string[]; tools?: string[] }[]
  >(row.mcpServers, []);
  return create(grackle.PersonaSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    toolConfig: create(grackle.ToolConfigSchema, {
      allowedTools: Array.isArray(toolConfig.allowedTools)
        ? toolConfig.allowedTools.filter(
            (t): t is string => typeof t === "string",
          )
        : [],
      disallowedTools: Array.isArray(toolConfig.disallowedTools)
        ? toolConfig.disallowedTools.filter(
            (t): t is string => typeof t === "string",
          )
        : [],
    }),
    runtime: row.runtime,
    model: row.model,
    maxTurns: row.maxTurns,
    mcpServers: mcpServers
      .filter(
        (
          s,
        ): s is {
          name: string;
          command: string;
          args?: string[];
          tools?: string[];
        } =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- typeof null === "object", JSON.parse can return null
          s !== null &&
          typeof s === "object" &&
          typeof s.name === "string" &&
          typeof s.command === "string",
      )
      .map((s) =>
        create(grackle.McpServerConfigSchema, {
          name: s.name,
          command: s.command,
          args: Array.isArray(s.args)
            ? s.args.filter((a): a is string => typeof a === "string")
            : [],
          tools: Array.isArray(s.tools)
            ? s.tools.filter((t): t is string => typeof t === "string")
            : [],
        }),
      ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    type: row.type || "agent",
    script: row.script || "",
  });
}

/** Convert persona MCP server configs to a JSON string for the PowerLine SpawnRequest. */
function personaMcpServersToJson(row: personaStore.PersonaRow): string {
  let mcpServers: { name: string; command: string; args?: string[]; tools?: string[] }[];
  try {
    mcpServers = JSON.parse(row.mcpServers || "[]") as typeof mcpServers;
  } catch {
    logger.warn({ personaId: row.id }, "Failed to parse persona mcpServers JSON; ignoring");
    return "";
  }
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return "";
  }
  return buildMcpServersJson(mcpServers);
}

/** Build a JSON string of MCP server configs for the PowerLine SpawnRequest. */
export function buildMcpServersJson(
  mcpServers: {
    name: string;
    command: string;
    args?: string[];
    tools?: string[];
  }[],
): string {
  const obj: Record<string, unknown> = {};
  for (const s of mcpServers) {
    obj[s.name] = {
      command: s.command,
      args: s.args || [],
      ...(s.tools && s.tools.length > 0 ? { tools: s.tools } : {}),
    };
  }
  return JSON.stringify(obj);
}

/**
 * Walk up the task parent chain and return the environmentId from the first
 * ancestor that has a session. Returns empty string if no ancestor has one.
 */
export function resolveAncestorEnvironmentId(parentTaskId: string): string {
  let currentId = parentTaskId;
  for (let i = 0; i < MAX_TASK_DEPTH && currentId; i++) {
    const session = sessionStore.getLatestSessionForTask(currentId);
    if (session?.environmentId) {
      return session.environmentId;
    }
    const parent = taskStore.getTask(currentId);
    if (!parent) {
      break;
    }
    currentId = parent.parentTaskId;
  }
  return "";
}

/** Register all Grackle gRPC service handlers on the given ConnectRPC router. */
export function registerGrackleRoutes(router: ConnectRouter): void {
  router.service(grackle.Grackle, {
    async listEnvironments() {
      const rows = envRegistry.listEnvironments();
      return create(grackle.EnvironmentListSchema, {
        environments: rows.map(envRowToProto),
      });
    },

    async addEnvironment(req: grackle.AddEnvironmentRequest) {
      if (!req.displayName || !req.adapterType) {
        throw new ConnectError("displayName and adapterType required", Code.InvalidArgument);
      }
      const id = req.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      envRegistry.addEnvironment(
        id,
        req.displayName,
        req.adapterType,
        req.adapterConfig,
      );
      emit("environment.changed", {});
      const row = envRegistry.getEnvironment(id);
      return envRowToProto(row!);
    },

    async updateEnvironment(req: grackle.UpdateEnvironmentRequest) {
      if (!req.id) {
        throw new ConnectError("id is required", Code.InvalidArgument);
      }
      const existing = envRegistry.getEnvironment(req.id);
      if (!existing) {
        throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
      }
      const displayName = req.displayName !== undefined ? req.displayName : undefined;
      if (displayName?.trim() === "") {
        throw new ConnectError("Environment name cannot be empty", Code.InvalidArgument);
      }
      let adapterConfig: string | undefined;
      if (req.adapterConfig !== undefined) {
        const raw = req.adapterConfig.trim() || "{}";
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new ConnectError("adapterConfig is not valid JSON", Code.InvalidArgument);
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new ConnectError("adapterConfig must be a JSON object", Code.InvalidArgument);
        }
        adapterConfig = raw;
      }
      const trimmedName = displayName !== undefined ? displayName.trim() : undefined;
      if (trimmedName === undefined && adapterConfig === undefined) {
        throw new ConnectError("No updatable fields provided", Code.InvalidArgument);
      }
      envRegistry.updateEnvironment(req.id, {
        displayName: trimmedName,
        adapterConfig,
      });
      logger.info({ environmentId: req.id, displayName: trimmedName }, "Environment updated");
      emit("environment.changed", {});
      const updated = envRegistry.getEnvironment(req.id);
      return envRowToProto(updated!);
    },

    async removeEnvironment(req: grackle.EnvironmentId) {
      // Block deletion if workspaces still reference this environment
      const wsCount = workspaceStore.countWorkspacesByEnvironment(req.id);
      if (wsCount > 0) {
        throw new ConnectError(
          `Cannot remove environment: ${wsCount} active workspace(s) still reference it. Archive or reparent them first.`,
          Code.FailedPrecondition,
        );
      }
      // Stop auto-reconnect attempts for this environment
      clearReconnectState(req.id);
      // Disconnect the adapter if currently connected
      const env = envRegistry.getEnvironment(req.id);
      if (env) {
        const adapter = adapterManager.getAdapter(env.adapterType);
        if (adapter) {
          try {
            await adapter.disconnect(req.id);
          } catch {
            /* best-effort */
          }
        }
      }
      adapterManager.removeConnection(req.id);
      // Delete sessions referencing this environment (FK constraint)
      sessionStore.deleteByEnvironment(req.id);
      envRegistry.removeEnvironment(req.id);
      emit("environment.changed", {});
      emit("environment.removed", { environmentId: req.id });
      return create(grackle.EmptySchema, {});
    },

    async *provisionEnvironment(req: grackle.EnvironmentId) {
      // Manual provision overrides auto-reconnect
      clearReconnectState(req.id);
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `Environment not found: ${req.id}`,
          progress: 0,
        });
        return;
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (!adapter) {
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `No adapter for type: ${env.adapterType}`,
          progress: 0,
        });
        return;
      }

      envRegistry.updateEnvironmentStatus(req.id, "connecting");
      emit("environment.changed", {});

      const config = parseAdapterConfig(env.adapterConfig);
      config.defaultRuntime = env.defaultRuntime;
      const powerlineToken = env.powerlineToken;

      try {
        for await (const event of reconnectOrProvision(
          req.id,
          adapter,
          config,
          powerlineToken,
          !!env.bootstrapped,
        )) {
          yield create(grackle.ProvisionEventSchema, {
            stage: event.stage,
            message: event.message,
            progress: event.progress,
          });
        }
      } catch (err) {
        logger.error({ environmentId: req.id, err }, "Provision/bootstrap failed");
        const currentEnv = envRegistry.getEnvironment(req.id);
        if (currentEnv?.status !== "connected") {
          envRegistry.updateEnvironmentStatus(req.id, "error");
          emit("environment.changed", {});
        }
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `Provision failed: ${err instanceof Error ? err.message : String(err)}`,
          progress: 0,
        });
        return;
      }

      try {
        const conn = await adapter.connect(req.id, config, powerlineToken);
        adapterManager.setConnection(req.id, conn);
        // Push stored tokens to newly connected environment
        await tokenPush.pushToEnv(req.id);
        envRegistry.updateEnvironmentStatus(req.id, "connected");
        envRegistry.markBootstrapped(req.id);
        emit("environment.changed", {});
        // Auto-recover suspended sessions (fire-and-forget)
        recoverSuspendedSessions(req.id, conn).catch((err) => {
          logger.error({ environmentId: req.id, err }, "Session recovery failed");
        });
      } catch (err) {
        // adapter.connect() actually failed
        envRegistry.updateEnvironmentStatus(req.id, "error");
        emit("environment.changed", {});
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
          progress: 0,
        });
        return;
      }

      // Best-effort: notify client that provision completed.
      // If the client already disconnected (e.g. fire-and-forget fetch in
      // test helpers), the yield throws — but the environment IS connected,
      // so we must NOT revert the status to "error".
      try {
        yield create(grackle.ProvisionEventSchema, {
          stage: "ready",
          message: "Environment connected",
          progress: 1,
        });
      } catch {
        // Client disconnected after successful provision — ignore
      }
    },

    async stopEnvironment(req: grackle.EnvironmentId) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        await adapter.stop(req.id, parseAdapterConfig(env.adapterConfig));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      emit("environment.changed", {});
      return create(grackle.EmptySchema, {});
    },

    async destroyEnvironment(req: grackle.EnvironmentId) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        await adapter.destroy(req.id, parseAdapterConfig(env.adapterConfig));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      emit("environment.changed", {});
      return create(grackle.EmptySchema, {});
    },

    async spawnAgent(req: grackle.SpawnRequest) {
      if (!req.environmentId) {
        throw new ConnectError("environment_id is required", Code.InvalidArgument);
      }
      const env = envRegistry.getEnvironment(req.environmentId);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
      }

      let conn = adapterManager.getConnection(req.environmentId);
      if (!conn) {
        // Auto-provision: attempt to reconnect/provision a disconnected environment
        const adapter = adapterManager.getAdapter(env.adapterType);
        if (!adapter) {
          throw new ConnectError(`No adapter for type: ${env.adapterType}`, Code.FailedPrecondition);
        }

        logger.info({ environmentId: req.environmentId }, "Auto-provisioning environment for SpawnAgent");
        envRegistry.updateEnvironmentStatus(req.environmentId, "connecting");
        emit("environment.changed", {});

        const config = parseAdapterConfig(env.adapterConfig);
        config.defaultRuntime = env.defaultRuntime;
        const powerlineToken = env.powerlineToken;

        try {
          for await (const provEvent of reconnectOrProvision(
            req.environmentId,
            adapter,
            config,
            powerlineToken,
            !!env.bootstrapped,
          )) {
            logger.info(
              { environmentId: req.environmentId, stage: provEvent.stage },
              "Auto-provision progress (SpawnAgent)",
            );
            emit("environment.provision_progress", {
              environmentId: req.environmentId,
              stage: provEvent.stage,
              message: provEvent.message,
              progress: provEvent.progress,
            });
          }

          conn = await adapter.connect(req.environmentId, config, powerlineToken);
          adapterManager.setConnection(req.environmentId, conn);
          await tokenPush.pushToEnv(req.environmentId);
          envRegistry.updateEnvironmentStatus(req.environmentId, "connected");
          envRegistry.markBootstrapped(req.environmentId);
          emit("environment.changed", {});
          // Auto-recover suspended sessions (fire-and-forget)
          recoverSuspendedSessions(req.environmentId, conn).catch((err) => {
            logger.error({ environmentId: req.environmentId, err }, "Session recovery failed");
          });
          logger.info({ environmentId: req.environmentId }, "Auto-provision complete (SpawnAgent)");
          emit("environment.provision_progress", {
            environmentId: req.environmentId,
            stage: "ready",
            message: "Environment connected",
            progress: 1,
          });
        } catch (err) {
          logger.error({ environmentId: req.environmentId, err }, "Auto-provision failed (SpawnAgent)");
          envRegistry.updateEnvironmentStatus(req.environmentId, "error");
          emit("environment.changed", {});
          throw new ConnectError(
            `Failed to auto-connect environment ${req.environmentId}: ${err instanceof Error ? err.message : String(err)}`,
            Code.FailedPrecondition,
          );
        }
      }

      // Resolve persona via cascade (request → app default)
      let resolved: ReturnType<typeof resolvePersona>;
      try {
        resolved = resolvePersona(req.personaId);
      } catch (err) {
        throw new ConnectError((err as Error).message, Code.FailedPrecondition);
      }

      const sessionId = uuid();
      const { runtime, model, systemPrompt, persona } = resolved;
      const maxTurns = req.maxTurns || resolved.maxTurns;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      const builderPrompt = new SystemPromptBuilder({
        personaPrompt: systemPrompt,
      }).build();
      const systemContext = req.systemContext
        ? builderPrompt + "\n\n" + req.systemContext
        : builderPrompt;

      // Validate pipe inputs before creating the session or spawning the child
      validatePipeInputs(req.pipe, req.parentSessionId);
      const pipeMode = req.pipe as PipeMode;

      sessionStore.createSession(
        sessionId,
        req.environmentId,
        runtime,
        req.prompt,
        model,
        logPath,
        "",                      // taskId
        resolved.personaId,      // personaId
        req.parentSessionId || "",  // parentSessionId
        pipeMode || "",          // pipeMode
      );

      const mcpServersJson = personaMcpServersToJson(persona);

      const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
      const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
      const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
      const mcpToken = createScopedToken(
        { sub: sessionId, pid: "", per: resolved.personaId, sid: sessionId },
        loadOrCreateApiKey(grackleHome),
      );

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: req.prompt,
        model,
        maxTurns,
        branch: req.branch,
        worktreeBasePath: req.branch
          ? (req.worktreeBasePath.trim() || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
          : "",
        systemContext,
        mcpServersJson,
        mcpUrl,
        mcpToken,
        scriptContent: resolved.type === "script" ? resolved.script : "",
        pipe: req.pipe,
      });

      // Create lifecycle stream — every session gets one. The spawner holds
      // a lifecycle fd; when it's closed, the session auto-stops.
      const lifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
      const spawnerId = req.parentSessionId || "__server__";
      streamRegistry.subscribe(lifecycleStream.id, spawnerId, "rw", "detach", true);
      streamRegistry.subscribe(lifecycleStream.id, sessionId, "rw", "detach", false);

      // Set up IPC pipe stream (optional, on top of lifecycle stream)
      let pipeFd = 0;
      if (pipeMode && pipeMode !== "detach" && req.parentSessionId) {
        const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
        const parentSub = streamRegistry.subscribe(
          ipcStream.id, req.parentSessionId, "rw",
          pipeMode === "sync" ? "sync" : "async",
          true,  // parent opened this via spawn
        );
        streamRegistry.subscribe(
          ipcStream.id, sessionId, "rw", "async",
          false, // child inherits
        );
        pipeFd = parentSub.fd;

        if (pipeMode === "async") {
          ensureAsyncDeliveryListener(req.parentSessionId);  // parent receives child messages
          ensureAsyncDeliveryListener(sessionId);             // child receives parent messages
        }
      }

      // Push fresh credentials before spawning (best-effort).
      // For local envs, skip file tokens — the PowerLine is on the same machine.
      await tokenPush.refreshTokensForTask(req.environmentId, runtime,
        env.adapterType === "local" ? { excludeFileTokens: true } : undefined);

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        systemContext,
        prompt: req.prompt,
      });

      const row = sessionStore.getSession(sessionId);
      const proto = sessionRowToProto(row!);
      proto.pipeFd = pipeFd;
      return proto;
    },

    async resumeAgent(req: grackle.ResumeRequest) {
      const row = reanimateAgent(req.sessionId);
      return sessionRowToProto(row);
    },

    async sendInput(req: grackle.InputMessage) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new ConnectError(`Session not found: ${req.sessionId}`, Code.NotFound);
      }
      if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
        throw new ConnectError(
          `Session ${req.sessionId} has ended (status: ${session.status})`,
          Code.FailedPrecondition,
        );
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        throw new ConnectError(`Environment ${session.environmentId} not connected`, Code.FailedPrecondition);
      }

      // Persist and publish user input event so subscribers see the text in the event stream
      const userInputEvent = create(grackle.SessionEventSchema, {
        sessionId: req.sessionId,
        type: grackle.EventType.USER_INPUT,
        timestamp: new Date().toISOString(),
        content: req.text,
        raw: "",
      });
      if (session.logPath) {
        logWriter.writeEvent(session.logPath, userInputEvent);
      }
      streamHub.publish(userInputEvent);

      await conn.client.sendInput(
        create(powerline.InputMessageSchema, {
          sessionId: req.sessionId,
          text: req.text,
        }),
      );

      return create(grackle.EmptySchema, {});
    },

    async getUsage(req: grackle.GetUsageRequest) {
      if (!req.id) {
        throw new ConnectError("id is required", Code.InvalidArgument);
      }
      switch (req.scope) {
        case "session": {
          const session = sessionStore.getSession(req.id);
          if (!session) {
            throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
          }
          return create(grackle.UsageStatsSchema, {
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens,
            costUsd: session.costUsd,
            sessionCount: 1,
          });
        }
        case "task": {
          const usage = sessionStore.aggregateUsage({ taskId: req.id });
          return create(grackle.UsageStatsSchema, usage);
        }
        case "task_tree": {
          const descendants = taskStore.getDescendants(req.id);
          const taskIds = [req.id, ...descendants.map((d) => d.id)];
          const usage = sessionStore.aggregateUsage({ taskIds });
          return create(grackle.UsageStatsSchema, usage);
        }
        case "workspace": {
          const tasks = taskStore.listTasks(req.id);
          const taskIds = tasks.map((t) => t.id);
          const usage = taskIds.length > 0
            ? sessionStore.aggregateUsage({ taskIds })
            : { inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 };
          return create(grackle.UsageStatsSchema, usage);
        }
        case "environment": {
          const usage = sessionStore.aggregateUsage({ environmentId: req.id });
          return create(grackle.UsageStatsSchema, usage);
        }
        default:
          throw new ConnectError(`Invalid usage scope: ${req.scope}`, Code.InvalidArgument);
      }
    },

    async waitForPipe(req: grackle.WaitForPipeRequest) {
      const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
      if (!sub) {
        throw new ConnectError(
          `No subscription found for session ${req.sessionId} fd ${req.fd}`,
          Code.NotFound,
        );
      }

      if (sub.deliveryMode !== "sync") {
        throw new ConnectError(
          `Subscription fd ${req.fd} is not a sync subscription (mode: ${sub.deliveryMode})`,
          Code.FailedPrecondition,
        );
      }

      // Use try/finally so the pipe stream is cleaned up even if consumeSync rejects
      // (e.g., the request is cancelled or times out) to prevent unbounded memory growth.
      let msg: Awaited<ReturnType<typeof streamRegistry.consumeSync>>;
      try {
        msg = await streamRegistry.consumeSync(sub.id);
      } finally {
        const stream = streamRegistry.getStream(sub.streamId);
        if (stream) {
          streamRegistry.deleteStream(sub.streamId);
        }
      }

      return create(grackle.WaitForPipeResponseSchema, {
        content: msg.content,
        senderSessionId: msg.senderId,
      });
    },

    async writeToFd(req: grackle.WriteToFdRequest) {
      const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
      if (!sub) {
        throw new ConnectError(
          `No subscription found for session ${req.sessionId} fd ${req.fd}`,
          Code.NotFound,
        );
      }
      if (sub.permission !== "w" && sub.permission !== "rw") {
        throw new ConnectError(
          `Subscription fd ${req.fd} does not have write permission (permission: ${sub.permission})`,
          Code.FailedPrecondition,
        );
      }

      const stream = streamRegistry.getStream(sub.streamId);
      if (!stream) {
        throw new ConnectError("Stream no longer exists", Code.FailedPrecondition);
      }

      // Publish to stream — delivery is handled by async listeners registered
      // at spawn time via ensureAsyncDeliveryListener. This is the same path
      // used by publishChildCompletion for child→parent delivery.
      const msg = streamRegistry.publish(sub.streamId, req.sessionId, req.message);

      // Verify delivery to async subscribers — check if the published message
      // was marked as delivered for each async target. Sync and detach subscribers
      // are excluded (sync waits for consumeSync, detach buffers silently).
      for (const targetSub of stream.subscriptions.values()) {
        if (targetSub.sessionId === req.sessionId) {
          continue;
        }
        if (targetSub.deliveryMode === "async" && !msg.deliveredTo.has(targetSub.id)) {
          throw new ConnectError(
            "Message delivery failed — target environment may be disconnected",
            Code.FailedPrecondition,
          );
        }
      }

      return create(grackle.EmptySchema, {});
    },

    async closeFd(req: grackle.CloseFdRequest) {
      const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
      if (!sub) {
        throw new ConnectError(
          `No subscription found for session ${req.sessionId} fd ${req.fd}`,
          Code.NotFound,
        );
      }
      if (streamRegistry.hasUndeliveredMessages(sub.id)) {
        throw new ConnectError(
          `Cannot close fd ${req.fd}: undelivered messages pending. Process or consume them first.`,
          Code.FailedPrecondition,
        );
      }

      const streamId = sub.streamId;
      const stream = streamRegistry.getStream(streamId);

      // Collect child sessions (inherited subscriptions, not the caller's)
      const childSubs: Array<{ sessionId: string; subId: string }> = [];
      if (stream) {
        for (const s of stream.subscriptions.values()) {
          if (s.sessionId !== req.sessionId) {
            childSubs.push({ sessionId: s.sessionId, subId: s.id });
          }
        }
      }

      // Unsubscribe the caller
      streamRegistry.unsubscribe(sub.id);

      // Also unsubscribe children — when their last subscription is removed,
      // the lifecycle manager's orphan callback auto-stops them.
      let stopped = false;
      for (const child of childSubs) {
        streamRegistry.unsubscribe(child.subId);
        // Check if the child was orphaned (auto-stopped)
        const childSession = sessionStore.getSession(child.sessionId);
        if (childSession?.status === SESSION_STATUS.STOPPED) {
          stopped = true;
        }
      }

      // Clean up async listeners for caller and any unsubscribed children
      pipeDelivery.cleanupAsyncListenerIfEmpty(req.sessionId);
      for (const child of childSubs) {
        pipeDelivery.cleanupAsyncListenerIfEmpty(child.sessionId);
      }

      return create(grackle.CloseFdResponseSchema, { stopped });
    },

    getSessionFds(req: grackle.SessionId) {
      const subs = streamRegistry.getSubscriptionsForSession(req.id);
      const fds = subs.map((sub) => {
        const stream = streamRegistry.getStream(sub.streamId);
        let targetSessionId = "";
        if (stream) {
          for (const s of stream.subscriptions.values()) {
            if (s.sessionId !== req.id) {
              targetSessionId = s.sessionId;
              break;
            }
          }
        }
        return create(grackle.FdInfoSchema, {
          fd: sub.fd,
          streamName: stream?.name || "",
          permission: sub.permission,
          deliveryMode: sub.deliveryMode,
          owned: sub.createdBySpawn,
          targetSessionId,
        });
      });
      return create(grackle.SessionFdsSchema, { fds });
    },

    async killAgent(req: grackle.SessionId) {
      const session = sessionStore.getSession(req.id);
      if (!session) {
        throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
      }

      // Set STOPPED + killed BEFORE closing the lifecycle FD so the orphan
      // callback sees the session is already terminal and skips. Without this,
      // the orphan callback would see IDLE → reason="completed", which is wrong
      // for an explicit kill.
      if (!TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
        sessionStore.updateSession(req.id, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.KILLED);
        streamHub.publish(
          create(grackle.SessionEventSchema, {
            sessionId: req.id,
            type: grackle.EventType.STATUS,
            timestamp: new Date().toISOString(),
            content: END_REASON.KILLED,
            raw: "",
          }),
        );
        if (session.taskId) {
          const task = taskStore.getTask(session.taskId);
          if (task) {
            emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
          }
        }
      }

      // Delete the lifecycle stream — orphan callback sees session is already
      // STOPPED and skips status change, but still kills the PowerLine process.
      cleanupLifecycleStream(req.id);

      // Also close any other subscriptions (pipe streams etc.)
      const subs = streamRegistry.getSubscriptionsForSession(req.id);
      for (const sub of subs) {
        streamRegistry.unsubscribe(sub.id);
      }

      return create(grackle.EmptySchema, {});
    },

    async listSessions(req: grackle.SessionFilter) {
      const rows = sessionStore.listSessions(req.environmentId, req.status);
      return create(grackle.SessionListSchema, {
        sessions: rows.map(sessionRowToProto),
      });
    },

    async getSession(req: grackle.SessionId) {
      const row = sessionStore.getSession(req.id);
      if (!row) {
        throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
      }
      return sessionRowToProto(row);
    },

    async getSessionEvents(req: grackle.SessionId) {
      const session = sessionStore.getSession(req.id);
      if (!session) {
        throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
      }
      if (!session.logPath) {
        return create(grackle.SessionEventListSchema, {
          sessionId: req.id,
          events: [],
        });
      }
      const entries = logWriter.readLog(session.logPath);
      return create(grackle.SessionEventListSchema, {
        sessionId: req.id,
        events: entries.map((e) =>
          create(grackle.SessionEventSchema, {
            sessionId: e.session_id,
            type: eventTypeToEnum(e.type),
            timestamp: e.timestamp,
            content: e.content,
            raw: e.raw || "",
          }),
        ),
      });
    },

    async getTaskSessions(req: grackle.TaskId) {
      if (!req.id) {
        throw new ConnectError("task id is required", Code.InvalidArgument);
      }
      const rows = sessionStore.listSessionsForTask(req.id);
      return create(grackle.SessionListSchema, {
        sessions: rows.map(sessionRowToProto),
      });
    },

    async *streamSession(req: grackle.SessionId) {
      const stream = streamHub.createStream(req.id);
      try {
        for await (const event of stream) {
          yield event;
        }
      } finally {
        stream.cancel();
      }
    },

    async *streamAll() {
      const stream = streamHub.createGlobalStream();
      try {
        for await (const event of stream) {
          yield event;
        }
      } finally {
        stream.cancel();
      }
    },

    async setToken(req: grackle.TokenEntry) {
      if (!req.name) {
        throw new ConnectError("name is required", Code.InvalidArgument);
      }
      if (!req.value) {
        throw new ConnectError("value is required", Code.InvalidArgument);
      }
      tokenStore.setToken({
        name: req.name,
        type: req.type,
        envVar: req.envVar,
        filePath: req.filePath,
        value: req.value,
        expiresAt: req.expiresAt,
      });
      emit("token.changed", {});
      await tokenPush.pushToAll();
      return create(grackle.EmptySchema, {});
    },

    async listTokens() {
      const items = tokenStore.listTokens();
      return create(grackle.TokenListSchema, {
        tokens: items.map((t) =>
          create(grackle.TokenInfoSchema, {
            name: t.name,
            type: t.type,
            envVar: t.envVar || "",
            filePath: t.filePath || "",
            expiresAt: t.expiresAt || "",
          }),
        ),
      });
    },

    async deleteToken(req: grackle.TokenName) {
      if (!req.name) {
        throw new ConnectError("name is required", Code.InvalidArgument);
      }
      tokenStore.deleteToken(req.name);
      emit("token.changed", {});
      await tokenPush.pushToAll();
      return create(grackle.EmptySchema, {});
    },

    // ─── Credential Providers ─────────────────────────────────

    async getCredentialProviders() {
      const config = credentialProviders.getCredentialProviders();
      return create(grackle.CredentialProviderConfigSchema, {
        claude: claudeProviderModeToEnum(config.claude),
        github: providerToggleToEnum(config.github),
        copilot: providerToggleToEnum(config.copilot),
        codex: providerToggleToEnum(config.codex),
        goose: providerToggleToEnum(config.goose),
      });
    },

    async setCredentialProvider(req: grackle.SetCredentialProviderRequest) {
      if (!credentialProviders.VALID_PROVIDERS.includes(req.provider)) {
        throw new ConnectError(
          `Invalid provider: ${req.provider}. Must be one of: ${credentialProviders.VALID_PROVIDERS.join(", ")}`,
          Code.InvalidArgument,
        );
      }

      const allowed = req.provider === "claude"
        ? credentialProviders.VALID_CLAUDE_VALUES
        : credentialProviders.VALID_TOGGLE_VALUES;

      if (!allowed.has(req.value)) {
        throw new ConnectError(
          `Invalid value for ${req.provider}: ${req.value}. Must be one of: ${[...allowed].join(", ")}`,
          Code.InvalidArgument,
        );
      }

      const current = credentialProviders.getCredentialProviders();
      const updated = { ...current, [req.provider]: req.value };
      credentialProviders.setCredentialProviders(updated);

      emit("credential.providers_changed", updated as unknown as Record<string, unknown>);

      return create(grackle.CredentialProviderConfigSchema, {
        claude: claudeProviderModeToEnum(updated.claude),
        github: providerToggleToEnum(updated.github),
        copilot: providerToggleToEnum(updated.copilot),
        codex: providerToggleToEnum(updated.codex),
        goose: providerToggleToEnum(updated.goose),
      });
    },

    // ─── Workspaces ──────────────────────────────────────────

    async listWorkspaces(req: grackle.ListWorkspacesRequest) {
      const rows = workspaceStore.listWorkspaces(req.environmentId || undefined);
      return create(grackle.WorkspaceListSchema, {
        workspaces: rows.map(workspaceRowToProto),
      });
    },

    async createWorkspace(req: grackle.CreateWorkspaceRequest) {
      if (!req.name) {
        throw new ConnectError("name is required", Code.InvalidArgument);
      }
      if (!req.environmentId) {
        throw new ConnectError("environment_id is required", Code.InvalidArgument);
      }
      const env = envRegistry.getEnvironment(req.environmentId);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
      }
      let id = slugify(req.name) || uuid().slice(0, 8);
      // If slug already exists (e.g. archived workspace), append a short suffix
      if (workspaceStore.getWorkspace(id)) {
        id = `${id}-${uuid().slice(0, 4)}`;
      }
      // useWorktrees defaults to true when not specified
      const useWorktrees = req.useWorktrees ?? true;
      workspaceStore.createWorkspace(
        id,
        req.name,
        req.description,
        req.repoUrl,
        req.environmentId,
        useWorktrees,
        req.worktreeBasePath ?? "",
        req.defaultPersonaId ?? "",
      );
      emit("workspace.created", { workspaceId: id });
      const row = workspaceStore.getWorkspace(id);
      return workspaceRowToProto(row!);
    },

    async getWorkspace(req: grackle.WorkspaceId) {
      const row = workspaceStore.getWorkspace(req.id);
      if (!row) throw new ConnectError(`Workspace not found: ${req.id}`, Code.NotFound);
      return workspaceRowToProto(row);
    },

    async archiveWorkspace(req: grackle.WorkspaceId) {
      workspaceStore.archiveWorkspace(req.id);
      emit("workspace.archived", { workspaceId: req.id });
      return create(grackle.EmptySchema, {});
    },

    async updateWorkspace(req: grackle.UpdateWorkspaceRequest) {
      const existing = workspaceStore.getWorkspace(req.id);
      if (!existing) {
        throw new ConnectError(`Workspace not found: ${req.id}`, Code.NotFound);
      }
      if (req.name?.trim() === "") {
        throw new ConnectError("Workspace name cannot be empty", Code.InvalidArgument);
      }
      if (req.repoUrl !== undefined && req.repoUrl !== "" && !/^https?:\/\//i.test(req.repoUrl)) {
        throw new ConnectError("Repository URL must use http or https scheme", Code.InvalidArgument);
      }
      if (req.environmentId !== undefined) {
        const env = envRegistry.getEnvironment(req.environmentId);
        if (!env) {
          throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
        }
      }
      const row = workspaceStore.updateWorkspace(req.id, {
        name: req.name !== undefined ? req.name.trim() : undefined,
        description: req.description,
        repoUrl: req.repoUrl,
        environmentId: req.environmentId,
        useWorktrees: req.useWorktrees ?? undefined,
        worktreeBasePath: req.worktreeBasePath,
        defaultPersonaId: req.defaultPersonaId,
      });
      if (!row) {
        throw new ConnectError(`Workspace not found after update: ${req.id}`, Code.NotFound);
      }
      emit("workspace.updated", { workspaceId: req.id });
      return workspaceRowToProto(row);
    },

    // ─── Tasks ───────────────────────────────────────────────

    async listTasks(req: grackle.ListTasksRequest) {
      const rows = taskStore.listTasks(req.workspaceId || undefined, {
        search: req.search || undefined,
        status: req.status || undefined,
      });
      const childIdsMap = taskStore.buildChildIdsMap(rows);

      // Batch-fetch sessions for all tasks and group by taskId
      const taskIds = rows.map((r) => r.id);
      const allSessions = sessionStore.listSessionsByTaskIds(taskIds);
      const sessionsByTask = new Map<string, typeof allSessions>();
      for (const s of allSessions) {
        const arr = sessionsByTask.get(s.taskId) ?? [];
        arr.push(s);
        sessionsByTask.set(s.taskId, arr);
      }

      return create(grackle.TaskListSchema, {
        tasks: rows.map((r) => {
          const taskSessions = sessionsByTask.get(r.id) ?? [];
          const { status, latestSessionId } = computeTaskStatus(r.status, taskSessions);
          return taskRowToProto(r, childIdsMap.get(r.id) ?? [], status, latestSessionId);
        }),
      });
    },

    async createTask(req: grackle.CreateTaskRequest) {
      if (!req.title) {
        throw new ConnectError("title is required", Code.InvalidArgument);
      }
      const workspaceId = req.workspaceId || undefined;
      let workspace: ReturnType<typeof workspaceStore.getWorkspace>;
      if (workspaceId) {
        workspace = workspaceStore.getWorkspace(workspaceId);
        if (!workspace) throw new ConnectError(`Workspace not found: ${workspaceId}`, Code.NotFound);
      }

      // Validate parent task if specified
      if (req.parentTaskId) {
        const parent = taskStore.getTask(req.parentTaskId);
        if (!parent)
          throw new ConnectError(`Parent task not found: ${req.parentTaskId}`, Code.NotFound);
        if (!parent.canDecompose) {
          throw new ConnectError(
            `Parent task "${parent.title}" (${req.parentTaskId}) does not have decomposition rights`,
            Code.FailedPrecondition,
          );
        }
        if (parent.depth + 1 > MAX_TASK_DEPTH) {
          throw new ConnectError(
            `Task depth would exceed maximum of ${MAX_TASK_DEPTH}`,
            Code.FailedPrecondition,
          );
        }
      }

      const id = uuid().slice(0, 8);
      taskStore.createTask(
        id,
        workspaceId,
        req.title,
        req.description,
        [...req.dependsOn],
        workspace ? slugify(workspace.name) : "",
        req.parentTaskId,
        // Default to false (no decomposition rights) unless explicitly granted.
        // Orchestrator/root processes that need fork() must opt in.
        req.canDecompose ?? false,
        req.defaultPersonaId ?? "",
      );
      const row = taskStore.getTask(id);
      emit("task.created", { taskId: id, workspaceId: req.workspaceId });
      return taskRowToProto(row!);
    },

    async getTask(req: grackle.TaskId) {
      const row = taskStore.getTask(req.id);
      if (!row) throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
      const taskSessions = sessionStore.listSessionsForTask(req.id);
      const { status, latestSessionId } = computeTaskStatus(row.status, taskSessions);
      return taskRowToProto(row, undefined, status, latestSessionId);
    },

    async updateTask(req: grackle.UpdateTaskRequest) {
      const existing = taskStore.getTask(req.id);
      if (!existing) throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);

      let reqStatus = existing.status;
      if (req.status !== grackle.TaskStatus.UNSPECIFIED) {
        if (req.id === ROOT_TASK_ID) {
          throw new ConnectError("Cannot change the status of the system task", Code.PermissionDenied);
        }
        const converted = taskStatusToString(req.status);
        if (!converted) {
          throw new ConnectError(`Unknown task status enum value: ${req.status}`, Code.InvalidArgument);
        }
        reqStatus = converted;
      }

      taskStore.updateTask(
        req.id,
        req.title !== "" ? req.title : existing.title,
        req.description !== "" ? req.description : existing.description,
        reqStatus,
        req.dependsOn.length > 0
          ? [...req.dependsOn]
          : safeParseJsonArray(existing.dependsOn),
        req.defaultPersonaId,
      );

      // Late-bind: associate an existing session with this task
      if (req.sessionId !== "") {
        const session = sessionStore.getSession(req.sessionId);
        if (!session) {
          throw new ConnectError(`Session not found: ${req.sessionId}`, Code.NotFound);
        }
        if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
          throw new ConnectError(
            `Cannot bind terminal session ${req.sessionId} (status: ${session.status})`,
            Code.FailedPrecondition,
          );
        }

        // Verify the processor exists before mutating DB state to avoid partial updates
        if (!processorRegistry.get(req.sessionId)) {
          throw new ConnectError(
            `No active event processor for session ${req.sessionId}`,
            Code.FailedPrecondition,
          );
        }

        sessionStore.setSessionTask(req.sessionId, req.id);
        processorRegistry.lateBind(req.sessionId, req.id, existing.workspaceId || undefined);
        emit("task.started", { taskId: req.id, sessionId: req.sessionId, workspaceId: existing.workspaceId || "" });
      }

      emit("task.updated", { taskId: req.id, workspaceId: existing.workspaceId || "" });

      const row = taskStore.getTask(req.id);
      const taskSessions = sessionStore.listSessionsForTask(req.id);
      const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
      return taskRowToProto(row!, undefined, status, latestSessionId);
    },

    async startTask(req: grackle.StartTaskRequest) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new ConnectError(`Task not found: ${req.taskId}`, Code.NotFound);
      {
        const taskSessions = sessionStore.listSessionsForTask(req.taskId);
        const { status: effectiveStatus } = computeTaskStatus(task.status, taskSessions);
        if (req.taskId === ROOT_TASK_ID) {
          // Root task is always re-startable unless actively working
          if (effectiveStatus === TASK_STATUS.WORKING) {
            throw new ConnectError("System is already running", Code.FailedPrecondition);
          }
        } else if (!([TASK_STATUS.NOT_STARTED, TASK_STATUS.FAILED] as string[]).includes(effectiveStatus)) {
          throw new ConnectError(
            `Task ${req.taskId} cannot be started (status: ${effectiveStatus})`,
            Code.FailedPrecondition,
          );
        }
      }
      if (!taskStore.areDependenciesMet(req.taskId)) {
        throw new ConnectError(`Task ${req.taskId} has unmet dependencies`, Code.FailedPrecondition);
      }

      const workspace = task.workspaceId ? workspaceStore.getWorkspace(task.workspaceId) : undefined;
      if (task.workspaceId && !workspace) {
        throw new ConnectError(`Workspace not found: ${task.workspaceId}`, Code.NotFound);
      }

      const environmentId = req.environmentId
        || resolveAncestorEnvironmentId(task.parentTaskId)
        || workspace?.environmentId
        || "";
      if (!environmentId) {
        throw new ConnectError("No environment specified for task, ancestor, or workspace", Code.FailedPrecondition);
      }

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new ConnectError(`Environment ${environmentId} not connected`, Code.FailedPrecondition);

      // Resolve persona via cascade (request → task → workspace → app default)
      let resolved: ReturnType<typeof resolvePersona>;
      try {
        resolved = resolvePersona(req.personaId, task.defaultPersonaId, workspace?.defaultPersonaId || "");
      } catch (err) {
        throw new ConnectError((err as Error).message, Code.FailedPrecondition);
      }

      // Validate pipe inputs before creating the session
      validatePipeInputs(req.pipe, req.parentSessionId);
      const taskPipeMode = req.pipe as PipeMode;

      const env = envRegistry.getEnvironment(environmentId);
      const sessionId = uuid();
      const { runtime, model, maxTurns, systemPrompt, persona } = resolved;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      const taskPrompt = buildTaskPrompt(task.title, task.description, req.notes);
      const isOrchestrator = task.canDecompose && task.depth <= 1;
      const orchestratorCtx = isOrchestrator
        ? fetchOrchestratorContext(task.workspaceId || "")
        : undefined;

      const systemContext = new SystemPromptBuilder({
        task: { title: task.title, description: task.description, notes: req.notes || "" },
        taskId: task.id,
        canDecompose: task.canDecompose,
        personaPrompt: systemPrompt,
        taskDepth: task.depth,
        ...orchestratorCtx,
        ...(orchestratorCtx && { triggerMode: "fresh" as const }),
      }).build();

      sessionStore.createSession(
        sessionId,
        environmentId,
        runtime,
        task.title,
        model,
        logPath,
        task.id,
        resolved.personaId,
        req.parentSessionId || "",  // parentSessionId
        taskPipeMode || "",         // pipeMode
      );
      emit("task.started", { taskId: task.id, sessionId, workspaceId: task.workspaceId || "" });

      // Re-push stored tokens + provider credentials (scoped to runtime) so they're fresh for this session.
      // For local envs, skip file tokens — the PowerLine is on the same machine.
      await tokenPush.refreshTokensForTask(environmentId, runtime,
        env?.adapterType === "local" ? { excludeFileTokens: true } : undefined);

      const mcpServersJson = personaMcpServersToJson(persona);

      const useWorktrees = workspace?.useWorktrees ?? false;
      if (!useWorktrees) {
        logger.warn(
          { taskId: task.id, workspaceId: task.workspaceId, branch: task.branch },
          "Worktrees disabled for workspace — agent will work in main checkout. Concurrent tasks on the same environment may conflict.",
        );
      }

      const taskMcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
      const taskMcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
      const taskMcpUrl = `http://${taskMcpDialHost}:${taskMcpPort}/mcp`;
      const taskMcpToken = createScopedToken(
        { sub: task.id, pid: task.workspaceId || "", per: resolved.personaId, sid: sessionId },
        loadOrCreateApiKey(grackleHome),
      );

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: taskPrompt,
        model,
        maxTurns,
        branch: task.branch,
        worktreeBasePath: task.branch
          ? (workspace?.worktreeBasePath || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
          : "",
        useWorktrees,
        systemContext,
        workspaceId: task.workspaceId ?? undefined,
        taskId: task.id,
        mcpServersJson,
        mcpUrl: taskMcpUrl,
        mcpToken: taskMcpToken,
        scriptContent: resolved.type === "script" ? resolved.script : "",
        pipe: req.pipe,
      });

      // Create lifecycle stream for the task session
      const taskLifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
      const taskSpawnerId = req.parentSessionId || "__server__";
      streamRegistry.subscribe(taskLifecycleStream.id, taskSpawnerId, "rw", "detach", true);
      streamRegistry.subscribe(taskLifecycleStream.id, sessionId, "rw", "detach", false);

      // Set up IPC pipe stream (optional)
      let taskPipeFd = 0;
      if (taskPipeMode && taskPipeMode !== "detach" && req.parentSessionId) {
        const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
        const parentSub = streamRegistry.subscribe(
          ipcStream.id, req.parentSessionId, "rw",
          taskPipeMode === "sync" ? "sync" : "async",
          true,
        );
        streamRegistry.subscribe(
          ipcStream.id, sessionId, "rw", "async",
          false,
        );
        taskPipeFd = parentSub.fd;

        if (taskPipeMode === "async") {
          ensureAsyncDeliveryListener(req.parentSessionId);  // parent receives child messages
          ensureAsyncDeliveryListener(sessionId);             // child receives parent messages
        }
      }

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        workspaceId: task.workspaceId ?? undefined,
        taskId: task.id,
        systemContext,
        prompt: taskPrompt,
      });

      const row = sessionStore.getSession(sessionId);
      const taskProto = sessionRowToProto(row!);
      taskProto.pipeFd = taskPipeFd;
      return taskProto;
    },

    async completeTask(req: grackle.TaskId) {
      if (req.id === ROOT_TASK_ID) {
        throw new ConnectError("Cannot complete the system task", Code.PermissionDenied);
      }
      const task = taskStore.getTask(req.id);
      if (!task) throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);

      taskStore.markTaskComplete(task.id, TASK_STATUS.COMPLETE);

      // Close lifecycle FDs for any active sessions — cascades to STOPPED via orphan callback
      const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
      for (const activeSession of activeSessions) {
        cleanupLifecycleStream(activeSession.id);
        const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
        for (const sub of subs) {
          streamRegistry.unsubscribe(sub.id);
        }
      }

      // Check for newly unblocked tasks
      if (task.workspaceId) {
        const unblocked = taskStore.checkAndUnblock(task.workspaceId);
        for (const t of unblocked) {
          streamHub.publish(
            create(grackle.SessionEventSchema, {
              sessionId: "",
              type: grackle.EventType.SYSTEM,
              timestamp: new Date().toISOString(),
              content: JSON.stringify({
                type: "task_unblocked",
                taskId: t.id,
                title: t.title,
              }),
              raw: "",
            }),
          );
        }
      }

      emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
      const row = taskStore.getTask(task.id);
      const taskSessions = sessionStore.listSessionsForTask(task.id);
      const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
      return taskRowToProto(row!, undefined, status, latestSessionId);
    },

    async resumeTask(req: grackle.TaskId) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);

      const latestSession = sessionStore.getLatestSessionForTask(req.id);
      if (!latestSession) {
        throw new ConnectError(`Task ${req.id} has no sessions to resume`, Code.FailedPrecondition);
      }
      if (!([SESSION_STATUS.STOPPED, SESSION_STATUS.SUSPENDED] as string[]).includes(latestSession.status)) {
        throw new ConnectError(
          `Latest session ${latestSession.id} is not resumable (status: ${latestSession.status})`,
          Code.FailedPrecondition,
        );
      }
      if (!latestSession.runtimeSessionId) {
        throw new ConnectError(
          `Latest session ${latestSession.id} has no runtime session ID — cannot resume`,
          Code.FailedPrecondition,
        );
      }

      const conn = adapterManager.getConnection(latestSession.environmentId);
      if (!conn) {
        throw new ConnectError(`Environment ${latestSession.environmentId} not connected`, Code.FailedPrecondition);
      }

      const powerlineReq = create(powerline.ResumeRequestSchema, {
        sessionId: latestSession.id,
        runtimeSessionId: latestSession.runtimeSessionId,
        runtime: latestSession.runtime,
      });

      const logPath =
        latestSession.logPath || join(grackleHome, LOGS_DIR, latestSession.id);

      // Reset session DB row to RUNNING (clears endedAt, error, etc.)
      sessionStore.reanimateSession(latestSession.id);

      // Re-create lifecycle stream if it was deleted during kill/stop
      const resumeSpawnerId = latestSession.parentSessionId || "__server__";
      ensureLifecycleStream(latestSession.id, resumeSpawnerId);

      processEventStream(conn.client.resume(powerlineReq), {
        sessionId: latestSession.id,
        logPath,
        workspaceId: task.workspaceId ?? undefined,
        taskId: task.id,
      });

      emit("task.started", { taskId: task.id, sessionId: latestSession.id, workspaceId: task.workspaceId || "" });

      const row = sessionStore.getSession(latestSession.id);
      return sessionRowToProto(row!);
    },

    async stopTask(req: grackle.TaskId) {
      const task = taskStore.getTask(req.id);
      if (!task) {
        throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
      }

      // Terminate all active sessions for this task using the fd-closure pattern
      const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
      for (const activeSession of activeSessions) {
        cleanupLifecycleStream(activeSession.id);
        const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
        for (const sub of subs) {
          streamRegistry.unsubscribe(sub.id);
        }
        const current = sessionStore.getSession(activeSession.id);
        if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus)) {
          sessionStore.updateSession(activeSession.id, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.INTERRUPTED);
          streamHub.publish(
            create(grackle.SessionEventSchema, {
              sessionId: activeSession.id,
              type: grackle.EventType.STATUS,
              timestamp: new Date().toISOString(),
              content: END_REASON.INTERRUPTED,
              raw: "",
            }),
          );
        }
      }

      // Mark task complete
      taskStore.markTaskComplete(req.id, TASK_STATUS.COMPLETE);

      // Check for newly unblocked tasks
      if (task.workspaceId) {
        taskStore.checkAndUnblock(task.workspaceId);
      }

      emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
      const updated = taskStore.getTask(req.id);
      const taskSessions = sessionStore.listSessionsForTask(req.id);
      const { status, latestSessionId } = computeTaskStatus(updated!.status, taskSessions);
      return taskRowToProto(updated!, undefined, status, latestSessionId);
    },

    async deleteTask(req: grackle.TaskId) {
      if (req.id === ROOT_TASK_ID) {
        throw new ConnectError("Cannot delete the system task", Code.PermissionDenied);
      }
      const task = taskStore.getTask(req.id);
      if (!task) {
        throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
      }
      const children = taskStore.getChildren(req.id);
      if (children.length > 0) {
        throw new ConnectError(
          "Cannot delete task with children. Delete children first.",
          Code.FailedPrecondition,
        );
      }

      // Terminate all active sessions via lifecycle cleanup before deleting the task
      const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
      for (const activeSession of activeSessions) {
        cleanupLifecycleStream(activeSession.id);
        const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
        for (const sub of subs) {
          streamRegistry.unsubscribe(sub.id);
        }
      }

      const changes = taskStore.deleteTask(req.id);
      if (changes === 0) {
        logger.error({ taskId: req.id }, "deleteTask returned 0 changes despite task existing");
        throw new ConnectError(
          `Failed to delete task ${req.id}: no rows affected`,
          Code.Internal,
        );
      }
      emit("task.deleted", { taskId: req.id, workspaceId: task.workspaceId || "" });
      return create(grackle.EmptySchema, {});
    },
    // ─── Personas ───────────────────────────────────────────────

    async listPersonas() {
      const rows = personaStore.listPersonas();
      return create(grackle.PersonaListSchema, {
        personas: rows.map(personaRowToProto),
      });
    },

    async createPersona(req: grackle.CreatePersonaRequest) {
      if (!req.name) throw new ConnectError("Persona name is required", Code.InvalidArgument);
      const personaType = req.type || "agent";
      if (personaType !== "agent" && personaType !== "script") {
        throw new ConnectError(`Invalid persona type: "${personaType}". Must be "agent" or "script".`, Code.InvalidArgument);
      }
      if (personaType === "script") {
        if (!req.script) {
          throw new ConnectError("Script content is required for script personas", Code.InvalidArgument);
        }
      } else {
        if (!req.systemPrompt) {
          throw new ConnectError("Persona system_prompt is required", Code.InvalidArgument);
        }
      }

      // Enforce unique ID and unique name
      let id = slugify(req.name) || uuid().slice(0, 8);
      if (personaStore.getPersona(id)) {
        id = `${id}-${uuid().slice(0, 4)}`;
      }
      if (personaStore.getPersonaByName(req.name)) {
        throw new ConnectError(`Persona with name "${req.name}" already exists`, Code.AlreadyExists);
      }

      const toolConfigJson = JSON.stringify({
        allowedTools: [...(req.toolConfig?.allowedTools || [])],
        disallowedTools: [...(req.toolConfig?.disallowedTools || [])],
      });
      const mcpServersJson = JSON.stringify(
        req.mcpServers.map((s) => ({
          name: s.name,
          command: s.command,
          args: [...s.args],
          tools: [...s.tools],
        })),
      );

      personaStore.createPersona(
        id,
        req.name,
        req.description,
        req.systemPrompt,
        toolConfigJson,
        req.runtime,
        req.model,
        req.maxTurns,
        mcpServersJson,
        personaType,
        req.script,
      );
      emit("persona.created", { personaId: id });
      const row = personaStore.getPersona(id);
      return personaRowToProto(row!);
    },

    async getPersona(req: grackle.PersonaId) {
      const row = personaStore.getPersona(req.id);
      if (!row) throw new ConnectError(`Persona not found: ${req.id}`, Code.NotFound);
      return personaRowToProto(row);
    },

    async updatePersona(req: grackle.UpdatePersonaRequest) {
      const existing = personaStore.getPersona(req.id);
      if (!existing) throw new ConnectError(`Persona not found: ${req.id}`, Code.NotFound);

      // Only update toolConfig/mcpServers if the request provides non-empty values;
      // otherwise keep the existing stored value.
      const hasNewToolConfig =
        !!req.toolConfig &&
        (req.toolConfig.allowedTools.length > 0 ||
          req.toolConfig.disallowedTools.length > 0);
      const toolConfigJson = hasNewToolConfig
        ? JSON.stringify({
            allowedTools: [...(req.toolConfig?.allowedTools || [])],
            disallowedTools: [...(req.toolConfig?.disallowedTools || [])],
          })
        : existing.toolConfig;

      const hasNewMcpServers =
        Array.isArray(req.mcpServers) && req.mcpServers.length > 0;
      const mcpServersJson = hasNewMcpServers
        ? JSON.stringify(
            req.mcpServers.map((s) => ({
              name: s.name,
              command: s.command,
              args: [...s.args],
              tools: [...s.tools],
            })),
          )
        : existing.mcpServers;

      // Treat empty string / 0 as "not set" and keep existing value
      const name = req.name || existing.name;
      if (name !== existing.name && personaStore.getPersonaByName(name)) {
        throw new ConnectError(`Persona with name "${name}" already exists`, Code.AlreadyExists);
      }
      const description = req.description || existing.description;
      const systemPrompt = req.systemPrompt || existing.systemPrompt;
      const runtime = req.runtime || existing.runtime;
      const model = req.model || existing.model;
      const maxTurns = req.maxTurns === 0 ? existing.maxTurns : req.maxTurns;
      // Empty string means "keep existing", non-empty means "set to this value"
      const updatedType = req.type || existing.type;
      const updatedScript = req.script || existing.script;

      personaStore.updatePersona(
        req.id,
        name,
        description,
        systemPrompt,
        toolConfigJson,
        runtime,
        model,
        maxTurns,
        mcpServersJson,
        updatedType,
        updatedScript,
      );
      emit("persona.updated", { personaId: req.id });
      const row = personaStore.getPersona(req.id);
      return personaRowToProto(row!);
    },

    async deletePersona(req: grackle.PersonaId) {
      personaStore.deletePersona(req.id);
      emit("persona.deleted", { personaId: req.id });
      return create(grackle.EmptySchema, {});
    },
    // ─── Settings ─────────────────────────────────────────────

    async getSetting(req: grackle.GetSettingRequest) {
      if (!isAllowedSettingKey(req.key)) {
        throw new ConnectError(`Setting key not allowed: ${req.key}`, Code.InvalidArgument);
      }
      const value = settingsStore.getSetting(req.key);
      return create(grackle.SettingResponseSchema, {
        key: req.key,
        value: value ?? "",
      });
    },

    async setSetting(req: grackle.SetSettingRequest) {
      if (!isAllowedSettingKey(req.key)) {
        throw new ConnectError(`Setting key not allowed: ${req.key}`, Code.InvalidArgument);
      }
      // Validate persona exists and has required fields when setting default_persona_id
      if (req.key === "default_persona_id" && req.value) {
        const persona = personaStore.getPersona(req.value);
        if (!persona) {
          throw new ConnectError(`Persona not found: ${req.value}`, Code.NotFound);
        }
        if (!persona.runtime || !persona.model) {
          throw new ConnectError(
            `Persona "${persona.name}" must have runtime and model configured`,
            Code.FailedPrecondition,
          );
        }
      }
      settingsStore.setSetting(req.key, req.value);
      emit("setting.changed", { key: req.key, value: req.value });
      return create(grackle.SettingResponseSchema, {
        key: req.key,
        value: req.value,
      });
    },

    // ─── Findings ────────────────────────────────────────────

    async postFinding(req: grackle.PostFindingRequest) {
      if (!req.title) {
        throw new ConnectError("title is required", Code.InvalidArgument);
      }
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id,
        req.workspaceId,
        req.taskId,
        req.sessionId,
        req.category,
        req.title,
        req.content,
        [...req.tags],
      );
      emit("finding.posted", { workspaceId: req.workspaceId, findingId: id });
      const rows = findingStore.queryFindings(req.workspaceId);
      const row = rows.find((r) => r.id === id);
      return findingRowToProto(row!);
    },

    async queryFindings(req: grackle.QueryFindingsRequest) {
      const rows = findingStore.queryFindings(
        req.workspaceId,
        req.categories.length > 0 ? [...req.categories] : undefined,
        req.tags.length > 0 ? [...req.tags] : undefined,
        req.limit || undefined,
      );
      return create(grackle.FindingListSchema, {
        findings: rows.map(findingRowToProto),
      });
    },

    // ─── Codespaces ────────────────────────────────────────────

    async listCodespaces() {
      try {
        const result = await exec(
          "gh",
          [
            "codespace",
            "list",
            "--json",
            "name,repository,state,gitStatus",
            "--limit",
            String(GH_CODESPACE_LIST_LIMIT),
          ],
          { timeout: GH_CODESPACE_LIST_TIMEOUT_MS },
        );
        const entries = JSON.parse(result.stdout || "[]") as Array<Record<string, unknown>>;
        return create(grackle.CodespaceListSchema, {
          codespaces: entries.map((e) =>
            create(grackle.CodespaceInfoSchema, {
              name: String(e.name ?? ""),
              repository: String(e.repository ?? ""),
              state: String(e.state ?? ""),
              gitStatus: String(e.gitStatus ?? ""),
            }),
          ),
        });
      } catch (err) {
        logger.warn({ err }, "Failed to list codespaces");
        return create(grackle.CodespaceListSchema, {
          codespaces: [],
          error: formatGhError(err, "list codespaces"),
        });
      }
    },

    async createCodespace(req: grackle.CreateCodespaceRequest) {
      if (!req.repo.trim()) {
        throw new ConnectError("repo is required", Code.InvalidArgument);
      }
      const trimmedRepo = req.repo.trim();
      const createArgs = ["codespace", "create", "--repo", trimmedRepo];
      if (req.machine.trim()) {
        createArgs.push("--machine", req.machine.trim());
      }
      try {
        const result = await exec("gh", createArgs, {
          timeout: GH_CODESPACE_CREATE_TIMEOUT_MS,
        });
        return create(grackle.CreateCodespaceResponseSchema, {
          name: result.stdout.trim(),
          repository: trimmedRepo,
        });
      } catch (err) {
        logger.error({ err, repo: trimmedRepo }, "Failed to create codespace");
        throw new ConnectError(
          formatGhError(err, "create codespace"),
          Code.Internal,
        );
      }
    },

    async generatePairingCode() {
      const code = generatePairingCode();
      if (!code) {
        throw new ConnectError(
          "Maximum active pairing codes reached. Wait for existing codes to expire.",
          Code.ResourceExhausted,
        );
      }

      const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
      const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";
      const WILDCARD_ADDRESSES: ReadonlySet<string> = new Set(["0.0.0.0", "::", "0:0:0:0:0:0:0:0"]);
      const pairingHost = WILDCARD_ADDRESSES.has(bindHost)
        ? (detectLanIp() || "localhost")
        : (bindHost === "127.0.0.1" || bindHost === "::1" ? "localhost" : bindHost);
      const url = `http://${pairingHost}:${webPort}/pair?code=${code}`;
      return create(grackle.PairingCodeResponseSchema, { code, url });
    },

    // ── Knowledge Graph ────────────────────────────────────────

    async searchKnowledge(req: grackle.SearchKnowledgeRequest) {
      const embedder: Embedder | undefined = getKnowledgeEmbedder();
      if (!embedder) {
        throw new ConnectError("Knowledge graph not available", Code.Unavailable);
      }

      const results = await knowledgeSearch(req.query, embedder, {
        limit: req.limit || 10,
        workspaceId: req.workspaceId || undefined,
      });

      return create(grackle.SearchKnowledgeResponseSchema, {
        results: results.map((r: SearchResult) =>
          create(grackle.SearchKnowledgeResultSchema, {
            score: r.score,
            node: knowledgeNodeToProto(r.node),
            edges: r.edges.map(knowledgeEdgeToProto),
          }),
        ),
      });
    },

    async getKnowledgeNode(req: grackle.GetKnowledgeNodeRequest) {
      if (!isKnowledgeEnabled()) {
        throw new ConnectError("Knowledge graph not available", Code.Unavailable);
      }

      const result = await getKnowledgeNodeById(req.id);
      if (!result) {
        throw new ConnectError(`Knowledge node not found: ${req.id}`, Code.NotFound);
      }

      return create(grackle.GetKnowledgeNodeResponseSchema, {
        node: knowledgeNodeToProto(result.node),
        edges: result.edges.map(knowledgeEdgeToProto),
      });
    },

    async expandKnowledgeNode(req: grackle.ExpandKnowledgeNodeRequest) {
      if (!isKnowledgeEnabled()) {
        throw new ConnectError("Knowledge graph not available", Code.Unavailable);
      }

      const result = await expandNode(req.id, {
        depth: req.depth || 1,
        edgeTypes: req.edgeTypes.length > 0 ? (req.edgeTypes as EdgeType[]) : undefined,
      });

      return create(grackle.ExpandKnowledgeNodeResponseSchema, {
        nodes: result.nodes.map(knowledgeNodeToProto),
        edges: result.edges.map(knowledgeEdgeToProto),
      });
    },

    async listRecentKnowledgeNodes(req: grackle.ListRecentKnowledgeNodesRequest) {
      if (!isKnowledgeEnabled()) {
        throw new ConnectError("Knowledge graph not available", Code.Unavailable);
      }

      const result = await listRecentNodes(
        req.limit || 20,
        req.workspaceId || undefined,
      );

      return create(grackle.ListRecentKnowledgeNodesResponseSchema, {
        nodes: result.nodes.map(knowledgeNodeToProto),
        edges: result.edges.map(knowledgeEdgeToProto),
      });
    },

    async createKnowledgeNode(req: grackle.CreateKnowledgeNodeRequest) {
      const embedder: Embedder | undefined = getKnowledgeEmbedder();
      if (!embedder) {
        throw new ConnectError("Knowledge graph not available", Code.Unavailable);
      }

      const chunker = createPassThroughChunker();
      const embedded = await ingest(req.content, chunker, embedder);
      if (embedded.length === 0) {
        throw new ConnectError("Content produced no embeddings", Code.InvalidArgument);
      }

      const id: string = await createNativeNode({
        category: (req.category || "insight") as "decision" | "insight" | "concept" | "snippet",
        title: req.title,
        content: req.content,
        tags: [...req.tags],
        embedding: embedded[0].vector,
        workspaceId: req.workspaceId || "",
      });

      return create(grackle.CreateKnowledgeNodeResponseSchema, { id });
    },

  });
}

// ---------------------------------------------------------------------------
// Knowledge graph proto converters
// ---------------------------------------------------------------------------

/** Convert a KnowledgeNode to its proto representation. */
function knowledgeNodeToProto(node: KnowledgeNode): grackle.KnowledgeNodeProto {
  return create(grackle.KnowledgeNodeProtoSchema, {
    id: node.id,
    kind: node.kind,
    workspaceId: node.workspaceId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    sourceType: node.kind === "reference" ? node.sourceType : "",
    sourceId: node.kind === "reference" ? node.sourceId : "",
    label: node.kind === "reference" ? node.label : "",
    category: node.kind === "native" ? node.category : "",
    title: node.kind === "native" ? node.title : "",
    content: node.kind === "native" ? node.content : "",
    tags: node.kind === "native" ? node.tags : [],
  });
}

/** Convert a KnowledgeEdge to its proto representation. */
function knowledgeEdgeToProto(edge: KnowledgeEdge): grackle.KnowledgeEdgeProto {
  return create(grackle.KnowledgeEdgeProtoSchema, {
    fromId: edge.fromId,
    toId: edge.toId,
    type: edge.type,
    metadataJson: edge.metadata ? JSON.stringify(edge.metadata) : "",
    createdAt: edge.createdAt,
  });
}
