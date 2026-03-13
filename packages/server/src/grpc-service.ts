import { ConnectError, Code, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import type { EnvironmentRow } from "./schema.js";
import type { SessionRow } from "./schema.js";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import { reconnectOrProvision } from "./adapters/adapter.js";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as projectStore from "./project-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import * as personaStore from "./persona-store.js";
import { broadcast } from "./ws-broadcast.js";
import { processEventStream } from "./event-processor.js";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_RUNTIME,
  DEFAULT_MODEL,
  MAX_TASK_DEPTH,
  taskStatusToEnum,
  taskStatusToString,
  projectStatusToEnum,
} from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { logger } from "./logger.js";
import { slugify } from "./utils/slugify.js";
import { buildTaskSystemContext } from "./utils/system-context.js";
import { importGitHubIssues as executeGitHubImport } from "./github-import.js";

function envRowToProto(row: EnvironmentRow): grackle.Environment {
  return create(grackle.EnvironmentSchema, {
    id: row.id,
    displayName: row.displayName,
    adapterType: row.adapterType,
    adapterConfig: row.adapterConfig,
    defaultRuntime: row.defaultRuntime,
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
    taskId: row.taskId ?? "",
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
  });
}

function taskRowToProto(
  row: taskStore.TaskRow,
  childIds?: string[],
): grackle.Task {
  return create(grackle.TaskSchema, {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: taskStatusToEnum(row.status),
    branch: row.branch,
    environmentId: row.environmentId,
    sessionId: row.sessionId,
    dependsOn: safeParseJsonArray(row.dependsOn),
    assignedAt: row.assignedAt ?? "",
    startedAt: row.startedAt ?? "",
    completedAt: row.completedAt ?? "",
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sortOrder: row.sortOrder,
    parentTaskId: row.parentTaskId,
    depth: row.depth,
    childTaskIds: childIds ?? taskStore.getChildren(row.id).map((c) => c.id),
    canDecompose: row.canDecompose,
    personaId: row.personaId,
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
          typeof s === "object" &&
          s !== null &&
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
  });
}

/** Convert persona MCP server configs to a JSON string for the PowerLine SpawnRequest. */
function personaMcpServersToJson(row: personaStore.PersonaRow): string {
  const mcpServers = JSON.parse(row.mcpServers || "[]") as {
    name: string;
    command: string;
    args?: string[];
    tools?: string[];
  }[];
  if (mcpServers.length === 0) {
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
      const runtime = req.defaultRuntime || DEFAULT_RUNTIME;
      envRegistry.addEnvironment(
        id,
        req.displayName,
        req.adapterType,
        req.adapterConfig,
        runtime,
      );
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
      broadcast({
        type: "environment_removed",
        payload: { environmentId: req.id },
      });
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

      const config = JSON.parse(env.adapterConfig);
      const powerlineToken = env.powerlineToken || "";

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

      try {
        const conn = await adapter.connect(req.id, config, powerlineToken);
        adapterManager.setConnection(req.id, conn);
        // Push stored tokens to newly connected environment
        await tokenBroker.pushToEnv(req.id);
        envRegistry.updateEnvironmentStatus(req.id, "connected");
        envRegistry.markBootstrapped(req.id);

        yield create(grackle.ProvisionEventSchema, {
          stage: "ready",
          message: "Environment connected",
          progress: 1,
        });
      } catch (err) {
        envRegistry.updateEnvironmentStatus(req.id, "error");
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `Connection failed: ${err}`,
          progress: 0,
        });
      }
    },

    async stopEnvironment(req: grackle.EnvironmentId) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        throw new Error(`Environment not found: ${req.id}`);
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        await adapter.stop(req.id, JSON.parse(env.adapterConfig));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      return create(grackle.EmptySchema, {});
    },

    async destroyEnvironment(req: grackle.EnvironmentId) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) {
        throw new Error(`Environment not found: ${req.id}`);
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        await adapter.destroy(req.id, JSON.parse(env.adapterConfig));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      return create(grackle.EmptySchema, {});
    },

    async spawnAgent(req: grackle.SpawnRequest) {
      const env = envRegistry.getEnvironment(req.environmentId);
      if (!env) {
        throw new Error(`Environment not found: ${req.environmentId}`);
      }

      const conn = adapterManager.getConnection(req.environmentId);
      if (!conn) {
        throw new Error(`Environment ${req.environmentId} not connected`);
      }

      // Resolve persona if specified
      const persona = req.personaId
        ? personaStore.getPersona(req.personaId)
        : undefined;
      if (req.personaId && !persona) {
        throw new Error(`Persona not found: ${req.personaId}`);
      }

      const sessionId = uuid();
      const runtime = req.runtime || persona?.runtime || env.defaultRuntime;
      const model =
        req.model ||
        persona?.model ||
        process.env.GRACKLE_DEFAULT_MODEL ||
        DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      let systemContext = req.systemContext || "";
      if (persona) {
        systemContext =
          persona.systemPrompt + (systemContext ? "\n\n" + systemContext : "");
      }

      sessionStore.createSession(
        sessionId,
        req.environmentId,
        runtime,
        req.prompt,
        model,
        logPath,
      );

      const mcpServersJson = persona ? personaMcpServersToJson(persona) : "";

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: req.prompt,
        model,
        maxTurns: persona?.maxTurns || 0,
        branch: req.branch || "",
        worktreeBasePath: req.branch ? "/workspace" : "",
        systemContext,
        mcpServersJson,
      });

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
      });

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async resumeAgent(req: grackle.ResumeRequest) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        throw new Error(`Environment ${session.environmentId} not connected`);
      }

      const powerlineReq = create(powerline.ResumeRequestSchema, {
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId || "",
        runtime: session.runtime,
      });

      const logPath =
        session.logPath || join(grackleHome, LOGS_DIR, session.id);

      processEventStream(conn.client.resume(powerlineReq), {
        sessionId: session.id,
        logPath,
      });

      const row = sessionStore.getSession(session.id);
      return sessionRowToProto(row!);
    },

    async sendInput(req: grackle.InputMessage) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }
      if (session.status !== "waiting_input") {
        throw new Error(
          `Session ${req.sessionId} is not waiting for input (status: ${session.status})`,
        );
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        throw new Error(`Environment ${session.environmentId} not connected`);
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
        throw new Error(`Session not found: ${req.id}`);
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (conn) {
        await conn.client.kill(
          create(powerline.SessionIdSchema, { id: req.id }),
        );
      }

      sessionStore.updateSession(req.id, "killed");
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: req.id,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: "killed",
          raw: "",
        }),
      );
      return create(grackle.EmptySchema, {});
    },

    async listSessions(req: grackle.SessionFilter) {
      const rows = sessionStore.listSessions(req.environmentId, req.status);
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
      projectStore.createProject(
        id,
        req.name,
        req.description,
        req.repoUrl,
        req.defaultEnvironmentId,
      );
      broadcast({ type: "project_created", payload: { projectId: id } });
      const row = projectStore.getProject(id);
      return projectRowToProto(row!);
    },

    async getProject(req: grackle.ProjectId) {
      const row = projectStore.getProject(req.id);
      if (!row) throw new Error(`Project not found: ${req.id}`);
      return projectRowToProto(row);
    },

    async archiveProject(req: grackle.ProjectId) {
      projectStore.archiveProject(req.id);
      broadcast({ type: "project_archived", payload: { projectId: req.id } });
      return create(grackle.EmptySchema, {});
    },

    // ─── Tasks ───────────────────────────────────────────────

    async listTasks(req: grackle.ProjectId) {
      const rows = taskStore.listTasks(req.id);
      const childIdsMap = taskStore.buildChildIdsMap(rows);
      return create(grackle.TaskListSchema, {
        tasks: rows.map((r) => taskRowToProto(r, childIdsMap.get(r.id) ?? [])),
      });
    },

    async createTask(req: grackle.CreateTaskRequest) {
      const project = projectStore.getProject(req.projectId);
      if (!project) throw new Error(`Project not found: ${req.projectId}`);

      // Validate parent task if specified
      if (req.parentTaskId) {
        const parent = taskStore.getTask(req.parentTaskId);
        if (!parent)
          throw new Error(`Parent task not found: ${req.parentTaskId}`);
        if (!parent.canDecompose) {
          throw new Error(
            `Parent task "${parent.title}" (${req.parentTaskId}) does not have decomposition rights`,
          );
        }
        if (parent.depth + 1 > MAX_TASK_DEPTH) {
          throw new Error(
            `Task depth would exceed maximum of ${MAX_TASK_DEPTH}`,
          );
        }
      }

      const id = uuid().slice(0, 8);
      // Resolve environment: explicit > parent task's env > project default
      let environmentId = req.environmentId;
      if (!environmentId && req.parentTaskId) {
        const parent = taskStore.getTask(req.parentTaskId);
        if (parent?.environmentId) {
          environmentId = parent.environmentId;
        }
      }
      if (!environmentId) {
        environmentId = project.defaultEnvironmentId;
      }
      taskStore.createTask(
        id,
        req.projectId,
        req.title,
        req.description,
        environmentId,
        [...req.dependsOn],
        slugify(project.name),
        req.parentTaskId,
        req.canDecompose,
        req.personaId,
      );
      const row = taskStore.getTask(id);
      broadcast({
        type: "task_created",
        payload: { task: row ? { ...row } : null },
      });
      return taskRowToProto(row!);
    },

    async getTask(req: grackle.TaskId) {
      const row = taskStore.getTask(req.id);
      if (!row) throw new Error(`Task not found: ${req.id}`);
      return taskRowToProto(row);
    },

    async updateTask(req: grackle.UpdateTaskRequest) {
      const existing = taskStore.getTask(req.id);
      if (!existing) throw new Error(`Task not found: ${req.id}`);

      let reqStatus = existing.status;
      if (req.status !== grackle.TaskStatus.UNSPECIFIED) {
        const converted = taskStatusToString(req.status);
        if (!converted) {
          throw new Error(`Unknown task status enum value: ${req.status}`);
        }
        reqStatus = converted;
      }

      taskStore.updateTask(
        req.id,
        req.title !== "" ? req.title : existing.title,
        req.description !== "" ? req.description : existing.description,
        reqStatus,
        req.environmentId !== "" ? req.environmentId : existing.environmentId,
        req.dependsOn.length > 0
          ? [...req.dependsOn]
          : safeParseJsonArray(existing.dependsOn),
        req.reviewNotes !== "" ? req.reviewNotes : existing.reviewNotes,
      );
      const row = taskStore.getTask(req.id);
      return taskRowToProto(row!);
    },

    async startTask(req: grackle.StartTaskRequest) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!["pending", "assigned", "failed"].includes(task.status)) {
        throw new Error(
          `Task ${req.taskId} cannot be started (status: ${task.status})`,
        );
      }
      if (!taskStore.areDependenciesMet(req.taskId)) {
        throw new Error(`Task ${req.taskId} has unmet dependencies`);
      }

      const project = projectStore.getProject(task.projectId);
      if (!project) throw new Error(`Project not found: ${task.projectId}`);

      const environmentId = task.environmentId || project.defaultEnvironmentId;
      if (!environmentId)
        throw new Error("No environment specified for task or project");

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new Error(`Environment ${environmentId} not connected`);

      // Resolve persona (StartTaskRequest override > task's stored persona)
      const personaId = req.personaId || task.personaId;
      const persona = personaId
        ? personaStore.getPersona(personaId)
        : undefined;
      if (personaId && !persona) {
        throw new Error(`Persona not found: ${personaId}`);
      }

      const env = envRegistry.getEnvironment(environmentId);
      const sessionId = uuid();
      const runtime =
        req.runtime ||
        persona?.runtime ||
        env?.defaultRuntime ||
        DEFAULT_RUNTIME;
      const model =
        req.model ||
        persona?.model ||
        process.env.GRACKLE_DEFAULT_MODEL ||
        DEFAULT_MODEL;
      const maxTurns = persona?.maxTurns || 0;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      let systemContext = buildTaskSystemContext(
        task.title,
        task.description,
        task.reviewNotes,
        task.canDecompose,
      );
      if (persona) {
        systemContext = persona.systemPrompt + "\n\n" + systemContext;
      }

      sessionStore.createSession(
        sessionId,
        environmentId,
        runtime,
        task.title,
        model,
        logPath,
        task.id,
      );
      taskStore.setTaskSession(task.id, sessionId);
      taskStore.markTaskStarted(task.id);
      broadcast({
        type: "task_started",
        payload: { taskId: task.id, sessionId, projectId: task.projectId },
      });

      const mcpServersJson = persona ? personaMcpServersToJson(persona) : "";

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: task.title,
        model,
        maxTurns,
        branch: task.branch,
        worktreeBasePath: task.branch ? "/workspace" : "",
        systemContext,
        projectId: task.projectId,
        taskId: task.id,
        mcpServersJson,
      });

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        projectId: task.projectId,
        taskId: task.id,
        onComplete: () => {
          // On completion, auto-move task to review
          const t = taskStore.getTask(task.id);
          if (t && (t.status === "in_progress" || t.status === "waiting_input")) {
            const sess = sessionStore.getSession(sessionId);
            if (sess?.status === "completed") {
              taskStore.markTaskCompleted(task.id, "review");
            } else if (sess?.status === "failed") {
              taskStore.markTaskCompleted(task.id, "failed");
            }
            broadcast({
              type: "task_updated",
              payload: { taskId: task.id, projectId: task.projectId },
            });
          }
        },
      });

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async approveTask(req: grackle.TaskId) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new Error(`Task not found: ${req.id}`);

      taskStore.markTaskCompleted(task.id, "done");

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

      broadcast({
        type: "task_approved",
        payload: { taskId: task.id, projectId: task.projectId },
      });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
    },

    async rejectTask(req: grackle.UpdateTaskRequest) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new Error(`Task not found: ${req.id}`);

      taskStore.updateTask(
        task.id,
        task.title,
        task.description,
        "assigned",
        task.environmentId,
        safeParseJsonArray(task.dependsOn),
        req.reviewNotes || "",
      );

      broadcast({
        type: "task_rejected",
        payload: { taskId: task.id, projectId: task.projectId },
      });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
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

      // Kill active session before deleting the task
      if (task.sessionId) {
        const activeSession = sessionStore.getSession(task.sessionId);
        if (activeSession && (activeSession.status === "running" || activeSession.status === "waiting_input")) {
          const conn = adapterManager.getConnection(activeSession.environmentId);
          if (conn) {
            try {
              await conn.client.kill(
                create(powerline.SessionIdSchema, { id: task.sessionId }),
              );
            } catch (err) {
              logger.warn({ taskId: req.id, sessionId: task.sessionId, err }, "Failed to kill session during task deletion");
            }
          }
          sessionStore.updateSession(task.sessionId, "killed");
          streamHub.publish(
            create(grackle.SessionEventSchema, {
              sessionId: task.sessionId,
              type: grackle.EventType.STATUS,
              timestamp: new Date().toISOString(),
              content: "killed",
              raw: "",
            }),
          );
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
      broadcast({
        type: "task_deleted",
        payload: { taskId: req.id, projectId: task.projectId },
      });
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
      if (!req.name) throw new Error("Persona name is required");
      if (!req.systemPrompt)
        throw new Error("Persona system_prompt is required");

      // Enforce unique ID and unique name
      let id = slugify(req.name) || uuid().slice(0, 8);
      if (personaStore.getPersona(id)) {
        id = `${id}-${uuid().slice(0, 4)}`;
      }
      if (personaStore.getPersonaByName(req.name)) {
        throw new Error(`Persona with name "${req.name}" already exists`);
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
      );
      broadcast({ type: "persona_created", payload: { personaId: id } });
      const row = personaStore.getPersona(id);
      return personaRowToProto(row!);
    },

    async getPersona(req: grackle.PersonaId) {
      const row = personaStore.getPersona(req.id);
      if (!row) throw new Error(`Persona not found: ${req.id}`);
      return personaRowToProto(row);
    },

    async updatePersona(req: grackle.UpdatePersonaRequest) {
      const existing = personaStore.getPersona(req.id);
      if (!existing) throw new Error(`Persona not found: ${req.id}`);

      // Only update toolConfig/mcpServers if the request provides non-empty values;
      // otherwise keep the existing stored value.
      const hasNewToolConfig =
        !!req.toolConfig &&
        ((req.toolConfig.allowedTools &&
          req.toolConfig.allowedTools.length > 0) ||
          (req.toolConfig.disallowedTools &&
            req.toolConfig.disallowedTools.length > 0));
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
        throw new Error(`Persona with name "${name}" already exists`);
      }
      const description = req.description || existing.description;
      const systemPrompt = req.systemPrompt || existing.systemPrompt;
      const runtime = req.runtime || existing.runtime;
      const model = req.model || existing.model;
      const maxTurns = req.maxTurns === 0 ? existing.maxTurns : req.maxTurns;

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
      );
      broadcast({ type: "persona_updated", payload: { personaId: req.id } });
      const row = personaStore.getPersona(req.id);
      return personaRowToProto(row!);
    },

    async deletePersona(req: grackle.PersonaId) {
      personaStore.deletePersona(req.id);
      broadcast({ type: "persona_deleted", payload: { personaId: req.id } });
      return create(grackle.EmptySchema, {});
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
      broadcast({
        type: "finding_posted",
        payload: { projectId: req.projectId, findingId: id },
      });
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
        throw new Error("state must be OPEN or CLOSED");
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

    // ─── Diff ────────────────────────────────────────────────

    async getTaskDiff(req: grackle.GetTaskDiffRequest) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!task.branch) throw new Error("Task has no branch");

      const environmentId =
        task.environmentId ||
        projectStore.getProject(task.projectId)?.defaultEnvironmentId;
      if (!environmentId) throw new Error("No environment for task");

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new Error(`Environment ${environmentId} not connected`);

      const diffResp = await conn.client.getDiff(
        create(powerline.DiffRequestSchema, {
          branch: task.branch,
          baseBranch: "main",
          worktreeBasePath: "/workspace",
        }),
      );

      return create(grackle.TaskDiffSchema, {
        taskId: task.id,
        branch: task.branch,
        diff: diffResp.diff,
        changedFiles: [...diffResp.changedFiles],
        additions: diffResp.additions,
        deletions: diffResp.deletions,
      });
    },
  });
}
