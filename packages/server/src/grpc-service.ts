import { ConnectError, Code, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import type { EnvironmentRow } from "./schema.js";
import type { SessionRow } from "./schema.js";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as projectStore from "./project-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import * as personaStore from "./persona-store.js";
import { emit } from "./event-bus.js";
import { processEventStream } from "./event-processor.js";
import * as processorRegistry from "./processor-registry.js";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_WEB_PORT,
  DEFAULT_MCP_PORT,
  MAX_TASK_DEPTH,
  SESSION_STATUS,
  TASK_STATUS,
  taskStatusToEnum,
  taskStatusToString,
  projectStatusToEnum,
  claudeProviderModeToEnum,
  providerToggleToEnum,
} from "@grackle-ai/common";
import { resolvePersona } from "./resolve-persona.js";
import * as settingsStore from "./settings-store.js";
import { isAllowedSettingKey } from "./settings-store.js";
import { createScopedToken } from "@grackle-ai/mcp";
import { grackleHome } from "./paths.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { computeTaskStatus } from "./compute-task-status.js";
import { loadOrCreateApiKey } from "./api-key.js";
import { logger } from "./logger.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { slugify } from "./utils/slugify.js";
import { buildTaskSystemContext } from "./utils/system-context.js";
import { importGitHubIssues as executeGitHubImport } from "./github-import.js";
import { generatePairingCode } from "./pairing.js";
import { detectLanIp } from "./utils/network.js";
import * as credentialProviders from "./credential-providers.js";

/**
 * Map a bind host to a dialable URL host. Wildcard addresses become loopback,
 * unless GRACKLE_DOCKER_HOST is set (DooD mode) — in that case, use that value
 * so sibling containers can reach the server by container name.
 */
export function toDialableHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    const dockerHost = process.env.GRACKLE_DOCKER_HOST;
    if (dockerHost) {
      return dockerHost;
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
  });
}

function projectRowToProto(row: projectStore.ProjectRow): grackle.Project {
  return create(grackle.ProjectSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repoUrl,
    defaultEnvironmentId: row.defaultEnvironmentId,
    status: projectStatusToEnum(row.status),
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
    projectId: row.projectId,
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

    async removeEnvironment(req: grackle.EnvironmentId) {
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

      const config = JSON.parse(env.adapterConfig) as Record<string, unknown>;
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
        envRegistry.updateEnvironmentStatus(req.id, "error");
        emit("environment.changed", {});
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
        await tokenBroker.pushToEnv(req.id);
        envRegistry.updateEnvironmentStatus(req.id, "connected");
        envRegistry.markBootstrapped(req.id);
        emit("environment.changed", {});

        yield create(grackle.ProvisionEventSchema, {
          stage: "ready",
          message: "Environment connected",
          progress: 1,
        });
      } catch (err) {
        envRegistry.updateEnvironmentStatus(req.id, "error");
        emit("environment.changed", {});
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
          progress: 0,
        });
      }
    },

    async stopEnvironment(req: grackle.EnvironmentId) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        await adapter.stop(req.id, JSON.parse(env.adapterConfig) as Record<string, unknown>);
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
        await adapter.destroy(req.id, JSON.parse(env.adapterConfig) as Record<string, unknown>);
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      emit("environment.changed", {});
      return create(grackle.EmptySchema, {});
    },

    async spawnAgent(req: grackle.SpawnRequest) {
      const env = envRegistry.getEnvironment(req.environmentId);
      if (!env) {
        throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
      }

      const conn = adapterManager.getConnection(req.environmentId);
      if (!conn) {
        throw new ConnectError(`Environment ${req.environmentId} not connected`, Code.FailedPrecondition);
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

      let systemContext = req.systemContext || "";
      if (systemPrompt) {
        systemContext =
          systemPrompt + (systemContext ? "\n\n" + systemContext : "");
      }

      sessionStore.createSession(
        sessionId,
        req.environmentId,
        runtime,
        req.prompt,
        model,
        logPath,
      );

      const mcpServersJson = personaMcpServersToJson(persona);

      const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
      const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
      const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
      const mcpToken = createScopedToken(
        { sub: sessionId, pid: "", per: resolved.personaId, sid: sessionId },
        loadOrCreateApiKey(),
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
      });

      // Push fresh credentials before spawning (best-effort).
      // For local envs, skip file tokens — the PowerLine is on the same machine.
      await tokenBroker.refreshTokensForTask(req.environmentId, runtime,
        env.adapterType === "local" ? { excludeFileTokens: true } : undefined);

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
      });

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
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
      if (session.status !== SESSION_STATUS.IDLE) {
        throw new ConnectError(
          `Session ${req.sessionId} is not idle (status: ${session.status})`,
          Code.FailedPrecondition,
        );
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        throw new ConnectError(`Environment ${session.environmentId} not connected`, Code.FailedPrecondition);
      }

      await conn.client.sendInput(
        create(powerline.InputMessageSchema, {
          sessionId: req.sessionId,
          text: req.text,
        }),
      );

      return create(grackle.EmptySchema, {});
    },

    async killAgent(req: grackle.SessionId) {
      const session = sessionStore.getSession(req.id);
      if (!session) {
        throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (conn) {
        try {
          await conn.client.kill(
            create(powerline.SessionIdSchema, { id: req.id }),
          );
        } catch (err) {
          logger.warn({ sessionId: req.id, err }, "PowerLine kill failed — marking session interrupted anyway");
        }
      }

      sessionStore.updateSession(req.id, SESSION_STATUS.INTERRUPTED);
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: req.id,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.INTERRUPTED,
          raw: "",
        }),
      );

      // Broadcast task_updated so frontend re-fetches computed status
      if (session.taskId) {
        const task = taskStore.getTask(session.taskId);
        if (task) {
          emit("task.updated", { taskId: task.id, projectId: task.projectId });
        }
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
      await tokenBroker.setToken({
        name: req.name,
        type: req.type,
        envVar: req.envVar,
        filePath: req.filePath,
        value: req.value,
        expiresAt: req.expiresAt,
      });
      return create(grackle.EmptySchema, {});
    },

    async listTokens() {
      const items = tokenBroker.listTokens();
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
      await tokenBroker.deleteToken(req.name);
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
      });
    },

    // ─── Projects ────────────────────────────────────────────

    async listProjects() {
      const rows = projectStore.listProjects();
      return create(grackle.ProjectListSchema, {
        projects: rows.map(projectRowToProto),
      });
    },

    async createProject(req: grackle.CreateProjectRequest) {
      let id = slugify(req.name) || uuid().slice(0, 8);
      // If slug already exists (e.g. archived project), append a short suffix
      if (projectStore.getProject(id)) {
        id = `${id}-${uuid().slice(0, 4)}`;
      }
      // useWorktrees defaults to true when not specified
      const useWorktrees = req.useWorktrees ?? true;
      projectStore.createProject(
        id,
        req.name,
        req.description,
        req.repoUrl,
        req.defaultEnvironmentId,
        useWorktrees,
        req.worktreeBasePath ?? "",
        req.defaultPersonaId ?? "",
      );
      emit("project.created", { projectId: id });
      const row = projectStore.getProject(id);
      return projectRowToProto(row!);
    },

    async getProject(req: grackle.ProjectId) {
      const row = projectStore.getProject(req.id);
      if (!row) throw new ConnectError(`Project not found: ${req.id}`, Code.NotFound);
      return projectRowToProto(row);
    },

    async archiveProject(req: grackle.ProjectId) {
      projectStore.archiveProject(req.id);
      emit("project.archived", { projectId: req.id });
      return create(grackle.EmptySchema, {});
    },

    async updateProject(req: grackle.UpdateProjectRequest) {
      const existing = projectStore.getProject(req.id);
      if (!existing) {
        throw new ConnectError(`Project not found: ${req.id}`, Code.NotFound);
      }
      if (req.name?.trim() === "") {
        throw new ConnectError("Project name cannot be empty", Code.InvalidArgument);
      }
      if (req.repoUrl !== undefined && req.repoUrl !== "" && !/^https?:\/\//i.test(req.repoUrl)) {
        throw new ConnectError("Repository URL must use http or https scheme", Code.InvalidArgument);
      }
      const row = projectStore.updateProject(req.id, {
        name: req.name !== undefined ? req.name.trim() : undefined,
        description: req.description,
        repoUrl: req.repoUrl,
        defaultEnvironmentId: req.defaultEnvironmentId,
        useWorktrees: req.useWorktrees ?? undefined,
        worktreeBasePath: req.worktreeBasePath,
        defaultPersonaId: req.defaultPersonaId,
      });
      if (!row) {
        throw new ConnectError(`Project not found after update: ${req.id}`, Code.NotFound);
      }
      emit("project.updated", { projectId: req.id });
      return projectRowToProto(row);
    },

    // ─── Tasks ───────────────────────────────────────────────

    async listTasks(req: grackle.ListTasksRequest) {
      const rows = taskStore.listTasks(req.projectId, {
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
      const project = projectStore.getProject(req.projectId);
      if (!project) throw new ConnectError(`Project not found: ${req.projectId}`, Code.NotFound);

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
        req.projectId,
        req.title,
        req.description,
        [...req.dependsOn],
        slugify(project.name),
        req.parentTaskId,
        // Default to false (no decomposition rights) unless explicitly granted.
        // Orchestrator/root processes that need fork() must opt in.
        req.canDecompose ?? false,
        req.defaultPersonaId ?? "",
      );
      const row = taskStore.getTask(id);
      emit("task.created", { taskId: id, projectId: req.projectId });
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
        const terminalStatuses: string[] = [SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.INTERRUPTED];
        if (terminalStatuses.includes(session.status)) {
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
        processorRegistry.lateBind(req.sessionId, req.id, existing.projectId);
        emit("task.started", { taskId: req.id, sessionId: req.sessionId, projectId: existing.projectId });
      }

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
        if (!([TASK_STATUS.NOT_STARTED, TASK_STATUS.FAILED] as string[]).includes(effectiveStatus)) {
          throw new ConnectError(
            `Task ${req.taskId} cannot be started (status: ${effectiveStatus})`,
            Code.FailedPrecondition,
          );
        }
      }
      if (!taskStore.areDependenciesMet(req.taskId)) {
        throw new ConnectError(`Task ${req.taskId} has unmet dependencies`, Code.FailedPrecondition);
      }

      const project = projectStore.getProject(task.projectId);
      if (!project) throw new ConnectError(`Project not found: ${task.projectId}`, Code.NotFound);

      const environmentId = req.environmentId || project.defaultEnvironmentId;
      if (!environmentId) {
        throw new ConnectError("No environment specified for task or project", Code.FailedPrecondition);
      }

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new ConnectError(`Environment ${environmentId} not connected`, Code.FailedPrecondition);

      // Resolve persona via cascade (request → task → project → app default)
      let resolved: ReturnType<typeof resolvePersona>;
      try {
        resolved = resolvePersona(req.personaId, task.defaultPersonaId, project.defaultPersonaId);
      } catch (err) {
        throw new ConnectError((err as Error).message, Code.FailedPrecondition);
      }

      const env = envRegistry.getEnvironment(environmentId);
      const sessionId = uuid();
      const { runtime, model, maxTurns, systemPrompt, persona } = resolved;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      let systemContext = buildTaskSystemContext(
        task.title,
        task.description,
        req.notes || "",
        task.canDecompose,
      );
      if (systemPrompt) {
        systemContext = systemPrompt + "\n\n" + systemContext;
      }

      sessionStore.createSession(
        sessionId,
        environmentId,
        runtime,
        task.title,
        model,
        logPath,
        task.id,
        resolved.personaId,
      );
      emit("task.started", { taskId: task.id, sessionId, projectId: task.projectId });

      // Re-push stored tokens + provider credentials (scoped to runtime) so they're fresh for this session.
      // For local envs, skip file tokens — the PowerLine is on the same machine.
      await tokenBroker.refreshTokensForTask(environmentId, runtime,
        env?.adapterType === "local" ? { excludeFileTokens: true } : undefined);

      const mcpServersJson = personaMcpServersToJson(persona);

      // When useWorktrees is false, omit worktreeBasePath so PowerLine checks
      // out the branch in the main working tree instead of creating a worktree.
      // The branch field is still populated so the agent knows its branch name.
      const useWorktrees = project.useWorktrees;
      if (!useWorktrees) {
        logger.warn(
          { taskId: task.id, projectId: task.projectId, branch: task.branch },
          "Worktrees disabled for project — agent will work in main checkout. Concurrent tasks on the same environment may conflict.",
        );
      }

      const taskMcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
      const taskMcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
      const taskMcpUrl = `http://${taskMcpDialHost}:${taskMcpPort}/mcp`;
      const taskMcpToken = createScopedToken(
        { sub: task.id, pid: task.projectId, per: resolved.personaId, sid: sessionId },
        loadOrCreateApiKey(),
      );

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: task.title,
        model,
        maxTurns,
        branch: task.branch,
        worktreeBasePath: task.branch && useWorktrees
          ? (project.worktreeBasePath || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
          : "",
        systemContext,
        projectId: task.projectId,
        taskId: task.id,
        mcpServersJson,
        mcpUrl: taskMcpUrl,
        mcpToken: taskMcpToken,
        scriptContent: resolved.type === "script" ? resolved.script : "",
      });

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        projectId: task.projectId,
        taskId: task.id,
      });

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async completeTask(req: grackle.TaskId) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);

      taskStore.markTaskComplete(task.id, TASK_STATUS.COMPLETE);

      // Check for newly unblocked tasks
      const unblocked = taskStore.checkAndUnblock(task.projectId);
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

      emit("task.completed", { taskId: task.id, projectId: task.projectId });
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
      if (!([SESSION_STATUS.INTERRUPTED, SESSION_STATUS.COMPLETED] as string[]).includes(latestSession.status)) {
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

      processEventStream(conn.client.resume(powerlineReq), {
        sessionId: latestSession.id,
        logPath,
        projectId: task.projectId,
        taskId: task.id,
      });

      emit("task.started", { taskId: task.id, sessionId: latestSession.id, projectId: task.projectId });

      const row = sessionStore.getSession(latestSession.id);
      return sessionRowToProto(row!);
    },

    async deleteTask(req: grackle.TaskId) {
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

      // Kill all active sessions before deleting the task
      const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
      for (const activeSession of activeSessions) {
        const conn = adapterManager.getConnection(activeSession.environmentId);
        if (conn) {
          try {
            await conn.client.kill(
              create(powerline.SessionIdSchema, { id: activeSession.id }),
            );
          } catch (err) {
            logger.warn({ taskId: req.id, sessionId: activeSession.id, err }, "Failed to kill session during task deletion");
          }
        }
        sessionStore.updateSession(activeSession.id, SESSION_STATUS.INTERRUPTED);
        streamHub.publish(
          create(grackle.SessionEventSchema, {
            sessionId: activeSession.id,
            type: grackle.EventType.STATUS,
            timestamp: new Date().toISOString(),
            content: SESSION_STATUS.INTERRUPTED,
            raw: "",
          }),
        );
      }

      const changes = taskStore.deleteTask(req.id);
      if (changes === 0) {
        logger.error({ taskId: req.id }, "deleteTask returned 0 changes despite task existing");
        throw new ConnectError(
          `Failed to delete task ${req.id}: no rows affected`,
          Code.Internal,
        );
      }
      emit("task.deleted", { taskId: req.id, projectId: task.projectId });
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
      const updatedType = req.type || existing.type || "agent";
      const updatedScript = req.script || existing.script || "";

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
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id,
        req.projectId,
        req.taskId,
        req.sessionId,
        req.category,
        req.title,
        req.content,
        [...req.tags],
      );
      emit("finding.posted", { projectId: req.projectId, findingId: id });
      const rows = findingStore.queryFindings(req.projectId);
      const row = rows.find((r) => r.id === id);
      return findingRowToProto(row!);
    },

    async queryFindings(req: grackle.QueryFindingsRequest) {
      const rows = findingStore.queryFindings(
        req.projectId,
        req.categories.length > 0 ? [...req.categories] : undefined,
        req.tags.length > 0 ? [...req.tags] : undefined,
        req.limit || undefined,
      );
      return create(grackle.FindingListSchema, {
        findings: rows.map(findingRowToProto),
      });
    },

    // ─── GitHub Import ────────────────────────────────────────

    async importGitHubIssues(req: grackle.ImportGitHubIssuesRequest) {
      if (req.state === grackle.IssueState.UNSPECIFIED) {
        throw new ConnectError("state must be OPEN or CLOSED", Code.InvalidArgument);
      }
      const stateStr =
        req.state === grackle.IssueState.CLOSED ? "closed" : "open";
      // include_comments defaults to true when not set (opt-out behaviour)
      const includeComments = req.includeComments ?? true;
      const result = await executeGitHubImport(
        req.projectId,
        req.repo,
        stateStr,
        req.label ?? undefined,
        req.environmentId ?? undefined,
        includeComments,
      );

      return create(grackle.ImportGitHubIssuesResponseSchema, result);
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

  });
}
