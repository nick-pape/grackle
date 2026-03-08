import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import type { EnvironmentRow } from "./schema.js";
import type { SessionRow } from "./schema.js";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as logWriter from "./log-writer.js";
import * as projectStore from "./project-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import { writeTranscript } from "./transcript.js";
import { broadcast } from "./ws-bridge.js";
import { join } from "node:path";
import {
  LOGS_DIR, DEFAULT_RUNTIME, DEFAULT_MODEL,
  environmentStatusToEnum, sessionStatusToEnum, sessionStatusToString,
  tokenTypeToEnum, tokenTypeToString,
  taskStatusToEnum, taskStatusToString, projectStatusToEnum,
} from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import { safeParseJsonArray } from "./json-helpers.js";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function envRowToProto(row: EnvironmentRow): grackle.Environment {
  return create(grackle.EnvironmentSchema, {
    id: row.id,
    displayName: row.displayName,
    adapterType: row.adapterType,
    adapterConfig: row.adapterConfig,
    defaultRuntime: row.defaultRuntime,
    bootstrapped: row.bootstrapped,
    status: environmentStatusToEnum(row.status),
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
    status: sessionStatusToEnum(row.status),
    logPath: row.logPath ?? "",
    turns: row.turns,
    startedAt: row.startedAt,
    suspendedAt: row.suspendedAt ?? "",
    endedAt: row.endedAt ?? "",
    error: row.error ?? "",
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

function taskRowToProto(row: taskStore.TaskRow): grackle.Task {
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
  });
}

function findingRowToProto(row: findingStore.FindingRow): grackle.Finding {
  return create(grackle.FindingSchema, { ...row, tags: safeParseJsonArray(row.tags) });
}

/** Spawn an agent session on a PowerLine, piping events to the stream hub. Returns the session ID. */
function spawnOnPowerLine(
  conn: ReturnType<typeof adapterManager.getConnection> & {},
  sessionId: string,
  runtime: string,
  prompt: string,
  model: string,
  logPath: string,
  branch: string,
  systemContext: string,
  projectId: string,
  taskId: string,
  onComplete?: () => void,
): void {
  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt,
    model,
    maxTurns: 0,
    branch,
    worktreeBasePath: branch ? "/workspace" : "",
    systemContext,
    projectId,
    taskId,
  });

  logWriter.initLog(logPath);

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      sessionStore.updateSession(sessionId, "running");
      for await (const event of conn.client.spawn(powerlineReq)) {
        const sessionEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: event.type as number as grackle.EventType,
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw,
        });
        logWriter.writeEvent(logPath, sessionEvent);

        // Intercept finding events and store + broadcast them
        if (event.type === powerline.AgentEventType.FINDING && projectId) {
          try {
            const data = JSON.parse(event.content);
            const findingId = uuid();
            findingStore.postFinding(
              findingId, projectId, taskId, sessionId,
              data.category || "general", data.title || "Untitled",
              data.content || "", data.tags || [],
            );
            broadcast({ type: "finding_posted", payload: { projectId, findingId } });
            process.stderr.write(`[finding] Stored: ${findingId} "${data.title}" in ${projectId}\n`);
          } catch (err) {
            process.stderr.write(`[finding] ERROR: ${err} (project=${projectId} task=${taskId})\n`);
          }
        }

        streamHub.publish(sessionEvent);

        if (event.type === powerline.AgentEventType.STATUS) {
          if (event.content === "waiting_input") {
            sessionStore.updateSessionStatus(sessionId, "waiting_input");
          } else if (event.content === "running") {
            sessionStore.updateSessionStatus(sessionId, "running");
          } else if (event.content === "completed") {
            sessionStore.updateSession(sessionId, "completed");
          } else if (event.content === "failed") {
            sessionStore.updateSession(sessionId, "failed");
          } else if (event.content === "killed") {
            sessionStore.updateSession(sessionId, "killed");
          }
        }
      }

      const current = sessionStore.getSession(sessionId);
      if (current && !["completed", "failed", "killed"].includes(current.status)) {
        sessionStore.updateSession(sessionId, "completed");
      }
    } catch (err) {
      sessionStore.updateSession(sessionId, "failed", undefined, String(err));
      // Publish a failure event so streaming clients are notified
      streamHub.publish(create(grackle.SessionEventSchema, {
        sessionId,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: "failed",
        raw: String(err),
      }));
    } finally {
      logWriter.endSession(logPath);
      try { writeTranscript(logPath); } catch { /* non-critical */ }
      onComplete?.();
    }
  })();
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
      envRegistry.addEnvironment(id, req.displayName, req.adapterType, req.adapterConfig, runtime);
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
          } catch { /* best-effort */ }
        }
      }
      adapterManager.removeConnection(req.id);
      // Delete sessions referencing this environment (FK constraint)
      sessionStore.deleteByEnvironment(req.id);
      envRegistry.removeEnvironment(req.id);
      broadcast({ type: "environment_removed", payload: { environmentId: req.id } });
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
      for await (const event of adapter.provision(req.id, config, powerlineToken)) {
        yield create(grackle.ProvisionEventSchema, {
          stage: event.stage,
          message: event.message,
          progress: event.progress,
        });
      }

      try {
        const conn = await adapter.connect(req.id, config, powerlineToken);
        adapterManager.setConnection(req.id, conn);
        envRegistry.updateEnvironmentStatus(req.id, "connected");

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

      const sessionId = uuid();
      const runtime = req.runtime || env.defaultRuntime;
      const model = req.model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      sessionStore.createSession(sessionId, req.environmentId, runtime, req.prompt, model, logPath);
      spawnOnPowerLine(conn, sessionId, runtime, req.prompt, model, logPath,
        req.branch || "", req.systemContext || "", "", "");

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

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        try {
          sessionStore.updateSession(session.id, "running");
          for await (const event of conn.client.resume(powerlineReq)) {
            const sessionEvent = create(grackle.SessionEventSchema, {
              sessionId: session.id,
              type: event.type as number as grackle.EventType,
              timestamp: event.timestamp,
              content: event.content,
              raw: event.raw,
            });
            streamHub.publish(sessionEvent);
          }
        } catch (err) {
          sessionStore.updateSession(session.id, "failed", undefined, String(err));
        }
      })();

      const row = sessionStore.getSession(session.id);
      return sessionRowToProto(row!);
    },

    async sendInput(req: grackle.InputMessage) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }
      if (session.status !== "waiting_input") {
        throw new Error(`Session ${req.sessionId} is not waiting for input (status: ${session.status})`);
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        throw new Error(`Environment ${session.environmentId} not connected`);
      }

      await conn.client.sendInput(
        create(powerline.InputMessageSchema, {
          sessionId: req.sessionId,
          text: req.text,
        })
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
          create(powerline.SessionIdSchema, { id: req.id })
        );
      }

      sessionStore.updateSession(req.id, "killed");
      streamHub.publish(create(grackle.SessionEventSchema, {
        sessionId: req.id,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: "killed",
        raw: "",
      }));
      return create(grackle.EmptySchema, {});
    },

    async listSessions(req: grackle.SessionFilter) {
      const rows = sessionStore.listSessions(req.environmentId, sessionStatusToString(req.status));
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
        type: tokenTypeToString(req.type),
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
            type: tokenTypeToEnum(t.type),
            envVar: t.envVar || "",
            filePath: t.filePath || "",
            expiresAt: t.expiresAt || "",
          })
        ),
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
      projectStore.createProject(id, req.name, req.description, req.repoUrl, req.defaultEnvironmentId);
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
      return create(grackle.TaskListSchema, {
        tasks: rows.map(taskRowToProto),
      });
    },

    async createTask(req: grackle.CreateTaskRequest) {
      const project = projectStore.getProject(req.projectId);
      if (!project) throw new Error(`Project not found: ${req.projectId}`);

      const id = uuid().slice(0, 8);
      const environmentId = req.environmentId || project.defaultEnvironmentId;
      taskStore.createTask(id, req.projectId, req.title, req.description, environmentId, [...req.dependsOn], slugify(project.name));
      const row = taskStore.getTask(id);
      broadcast({ type: "task_created", payload: { task: row ? { ...row } : null } });
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

      const reqStatus = req.status !== grackle.TaskStatus.UNSPECIFIED
        ? taskStatusToString(req.status)
        : existing.status;

      taskStore.updateTask(
        req.id,
        req.title || existing.title,
        req.description || existing.description,
        reqStatus,
        req.environmentId || existing.environmentId,
        req.dependsOn.length > 0 ? [...req.dependsOn] : safeParseJsonArray(existing.dependsOn),
        req.reviewNotes || existing.reviewNotes,
      );
      const row = taskStore.getTask(req.id);
      return taskRowToProto(row!);
    },

    async startTask(req: grackle.StartTaskRequest) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!["pending", "assigned"].includes(task.status)) {
        throw new Error(`Task ${req.taskId} cannot be started (status: ${task.status})`);
      }
      if (!taskStore.areDependenciesMet(req.taskId)) {
        throw new Error(`Task ${req.taskId} has unmet dependencies`);
      }

      const project = projectStore.getProject(task.projectId);
      if (!project) throw new Error(`Project not found: ${task.projectId}`);

      const environmentId = task.environmentId || project.defaultEnvironmentId;
      if (!environmentId) throw new Error("No environment specified for task or project");

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new Error(`Environment ${environmentId} not connected`);

      const env = envRegistry.getEnvironment(environmentId);
      const sessionId = uuid();
      const runtime = req.runtime || env?.defaultRuntime || DEFAULT_RUNTIME;
      const model = req.model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      // Build system context: task info + review notes + MCP tool instructions
      const systemContext = [
        `## Task: ${task.title}`,
        task.description,
        task.reviewNotes ? `## Review Feedback (from previous attempt)\n${task.reviewNotes}` : "",
        `## Grackle Tools (MCP)`,
        `You have a "grackle" MCP server with tools for coordinating with other agents:`,
        `- **mcp__grackle__post_finding**: Share discoveries (architecture decisions, bugs, patterns) with other agents working on this project. Parameters: title (string), content (string), category (optional: architecture|api|bug|decision|dependency|pattern|general), tags (optional: string[]).`,
        `- **mcp__grackle__query_findings**: Query findings posted by other agents. Findings from previous tasks are also in your system context above.`,
        `IMPORTANT: When you complete your task, post at least one finding summarizing what you did and any key decisions made.`,
      ].filter(Boolean).join("\n\n");

      sessionStore.createSession(sessionId, environmentId, runtime, task.title, model, logPath);
      taskStore.setTaskSession(task.id, sessionId);
      taskStore.markTaskStarted(task.id);
      broadcast({ type: "task_started", payload: { taskId: task.id, sessionId, projectId: task.projectId } });

      spawnOnPowerLine(conn, sessionId, runtime, task.title, model, logPath,
        task.branch, systemContext, task.projectId, task.id,
        () => {
          // On completion, auto-move task to review
          const t = taskStore.getTask(task.id);
          if (t && t.status === "in_progress") {
            const sess = sessionStore.getSession(sessionId);
            if (sess?.status === "completed") {
              taskStore.markTaskCompleted(task.id, "review");
            } else if (sess?.status === "failed") {
              taskStore.markTaskCompleted(task.id, "failed");
            }
            broadcast({ type: "task_updated", payload: { taskId: task.id, projectId: task.projectId } });
          }
        },
      );

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
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId: "",
          type: grackle.EventType.SYSTEM,
          timestamp: new Date().toISOString(),
          content: JSON.stringify({ type: "task_unblocked", taskId: t.id, title: t.title }),
          raw: "",
        }));
      }

      broadcast({ type: "task_approved", payload: { taskId: task.id, projectId: task.projectId } });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
    },

    async rejectTask(req: grackle.UpdateTaskRequest) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new Error(`Task not found: ${req.id}`);

      taskStore.updateTask(
        task.id, task.title, task.description, "assigned",
        task.environmentId, safeParseJsonArray(task.dependsOn), req.reviewNotes || "",
      );

      broadcast({ type: "task_rejected", payload: { taskId: task.id, projectId: task.projectId } });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
    },

    async deleteTask(req: grackle.TaskId) {
      const task = taskStore.getTask(req.id);
      taskStore.deleteTask(req.id);
      broadcast({ type: "task_deleted", payload: { taskId: req.id, projectId: task?.projectId } });
      return create(grackle.EmptySchema, {});
    },

    // ─── Findings ────────────────────────────────────────────

    async postFinding(req: grackle.PostFindingRequest) {
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id, req.projectId, req.taskId, req.sessionId,
        req.category, req.title, req.content, [...req.tags],
      );
      broadcast({ type: "finding_posted", payload: { projectId: req.projectId, findingId: id } });
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

    // ─── Diff ────────────────────────────────────────────────

    async getTaskDiff(req: grackle.GetTaskDiffRequest) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!task.branch) throw new Error("Task has no branch");

      const environmentId = task.environmentId || projectStore.getProject(task.projectId)?.defaultEnvironmentId;
      if (!environmentId) throw new Error("No environment for task");

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) throw new Error(`Environment ${environmentId} not connected`);

      const diffResp = await conn.client.getDiff(
        create(powerline.DiffRequestSchema, {
          branch: task.branch,
          baseBranch: "main",
          worktreeBasePath: "/workspace",
        })
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
