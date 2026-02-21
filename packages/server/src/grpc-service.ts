import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle/common";
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
import { LOGS_DIR, DEFAULT_RUNTIME, DEFAULT_MODEL } from "@grackle/common";
import { grackleHome } from "./paths.js";

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
    status: row.status,
    lastSeen: row.lastSeen || "",
    envInfo: row.envInfo || "",
    createdAt: row.createdAt,
  });
}

function sessionRowToProto(row: SessionRow): grackle.Session {
  return create(grackle.SessionSchema, {
    id: row.id,
    envId: row.envId,
    runtime: row.runtime,
    runtimeSessionId: row.runtimeSessionId || "",
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    logPath: row.logPath || "",
    turns: row.turns,
    startedAt: row.startedAt,
    suspendedAt: row.suspendedAt || "",
    endedAt: row.endedAt || "",
    error: row.error || "",
  });
}

function projectRowToProto(row: projectStore.ProjectRow): grackle.Project {
  return create(grackle.ProjectSchema, {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    defaultEnvId: row.default_env_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function taskRowToProto(row: taskStore.TaskRow): grackle.Task {
  return create(grackle.TaskSchema, {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    branch: row.branch,
    envId: row.env_id,
    sessionId: row.session_id,
    dependsOn: JSON.parse(row.depends_on),
    assignedAt: row.assigned_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    reviewNotes: row.review_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
  });
}

function findingRowToProto(row: findingStore.FindingRow): grackle.Finding {
  return create(grackle.FindingSchema, {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    category: row.category,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags),
    createdAt: row.created_at,
  });
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

  (async () => {
    try {
      sessionStore.updateSession(sessionId, "running");
      for await (const event of conn.client.spawn(powerlineReq)) {
        const sessionEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: event.type,
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw,
        });
        logWriter.writeEvent(logPath, sessionEvent);

        // Intercept finding events
        if (event.type === "finding" && projectId) {
          try {
            const data = JSON.parse(event.content);
            findingStore.postFinding(
              uuid(), projectId, taskId, sessionId,
              data.category || "general", data.title || "Untitled",
              data.content || "", data.tags || [],
            );
          } catch { /* ignore parse errors */ }
        }

        streamHub.publish(sessionEvent);

        if (event.type === "status") {
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
        type: "status",
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

    async addEnvironment(req) {
      const id = req.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const runtime = req.defaultRuntime || DEFAULT_RUNTIME;
      envRegistry.addEnvironment(id, req.displayName, req.adapterType, req.adapterConfig, runtime);
      const row = envRegistry.getEnvironment(id);
      return envRowToProto(row!);
    },

    async removeEnvironment(req) {
      envRegistry.removeEnvironment(req.id);
      return create(grackle.EmptySchema, {});
    },

    async *provisionEnvironment(req) {
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

    async stopEnvironment(req) {
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

    async destroyEnvironment(req) {
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

    async spawnAgent(req) {
      const env = envRegistry.getEnvironment(req.envId);
      if (!env) {
        throw new Error(`Environment not found: ${req.envId}`);
      }

      const conn = adapterManager.getConnection(req.envId);
      if (!conn) {
        throw new Error(`Environment ${req.envId} not connected`);
      }

      const sessionId = uuid();
      const runtime = req.runtime || env.defaultRuntime;
      const model = req.model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      sessionStore.createSession(sessionId, req.envId, runtime, req.prompt, model, logPath);
      spawnOnPowerLine(conn, sessionId, runtime, req.prompt, model, logPath,
        req.branch || "", req.systemContext || "", "", "");

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async resumeAgent(req) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }

      const conn = adapterManager.getConnection(session.envId);
      if (!conn) {
        throw new Error(`Environment ${session.envId} not connected`);
      }

      const powerlineReq = create(powerline.ResumeRequestSchema, {
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId || "",
        runtime: session.runtime,
      });

      (async () => {
        try {
          sessionStore.updateSession(session.id, "running");
          for await (const event of conn.client.resume(powerlineReq)) {
            const sessionEvent = create(grackle.SessionEventSchema, {
              sessionId: session.id,
              type: event.type,
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

    async sendInput(req) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }
      if (session.status !== "waiting_input") {
        throw new Error(`Session ${req.sessionId} is not waiting for input (status: ${session.status})`);
      }

      const conn = adapterManager.getConnection(session.envId);
      if (!conn) {
        throw new Error(`Environment ${session.envId} not connected`);
      }

      await conn.client.sendInput(
        create(powerline.InputMessageSchema, {
          sessionId: req.sessionId,
          text: req.text,
        })
      );

      return create(grackle.EmptySchema, {});
    },

    async killAgent(req) {
      const session = sessionStore.getSession(req.id);
      if (!session) {
        throw new Error(`Session not found: ${req.id}`);
      }

      const conn = adapterManager.getConnection(session.envId);
      if (conn) {
        await conn.client.kill(
          create(powerline.SessionIdSchema, { id: req.id })
        );
      }

      sessionStore.updateSession(req.id, "killed");
      streamHub.publish(create(grackle.SessionEventSchema, {
        sessionId: req.id,
        type: "status",
        timestamp: new Date().toISOString(),
        content: "killed",
        raw: "",
      }));
      return create(grackle.EmptySchema, {});
    },

    async listSessions(req) {
      const rows = sessionStore.listSessions(req.envId, req.status);
      return create(grackle.SessionListSchema, {
        sessions: rows.map(sessionRowToProto),
      });
    },

    async *streamSession(req) {
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

    async setToken(req) {
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

    async createProject(req) {
      const id = slugify(req.name) || uuid().slice(0, 8);
      projectStore.createProject(id, req.name, req.description, req.repoUrl, req.defaultEnvId);
      broadcast({ type: "project_created", payload: { projectId: id } });
      const row = projectStore.getProject(id);
      return projectRowToProto(row!);
    },

    async getProject(req) {
      const row = projectStore.getProject(req.id);
      if (!row) throw new Error(`Project not found: ${req.id}`);
      return projectRowToProto(row);
    },

    async archiveProject(req) {
      projectStore.archiveProject(req.id);
      broadcast({ type: "project_archived", payload: { projectId: req.id } });
      return create(grackle.EmptySchema, {});
    },

    // ─── Tasks ───────────────────────────────────────────────

    async listTasks(req) {
      const rows = taskStore.listTasks(req.id);
      return create(grackle.TaskListSchema, {
        tasks: rows.map(taskRowToProto),
      });
    },

    async createTask(req) {
      const project = projectStore.getProject(req.projectId);
      if (!project) throw new Error(`Project not found: ${req.projectId}`);

      const id = uuid().slice(0, 8);
      const envId = req.envId || project.default_env_id;
      taskStore.createTask(id, req.projectId, req.title, req.description, envId, [...req.dependsOn], slugify(project.name));
      const row = taskStore.getTask(id);
      broadcast({ type: "task_created", payload: { task: row ? { ...row, projectId: row.project_id } : null } });
      return taskRowToProto(row!);
    },

    async getTask(req) {
      const row = taskStore.getTask(req.id);
      if (!row) throw new Error(`Task not found: ${req.id}`);
      return taskRowToProto(row);
    },

    async updateTask(req) {
      const existing = taskStore.getTask(req.id);
      if (!existing) throw new Error(`Task not found: ${req.id}`);

      taskStore.updateTask(
        req.id,
        req.title || existing.title,
        req.description || existing.description,
        req.status || existing.status,
        req.envId || existing.env_id,
        req.dependsOn.length > 0 ? [...req.dependsOn] : JSON.parse(existing.depends_on),
        req.reviewNotes || existing.review_notes,
      );
      const row = taskStore.getTask(req.id);
      return taskRowToProto(row!);
    },

    async startTask(req) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!["pending", "assigned"].includes(task.status)) {
        throw new Error(`Task ${req.taskId} cannot be started (status: ${task.status})`);
      }
      if (!taskStore.areDependenciesMet(req.taskId)) {
        throw new Error(`Task ${req.taskId} has unmet dependencies`);
      }

      const project = projectStore.getProject(task.project_id);
      if (!project) throw new Error(`Project not found: ${task.project_id}`);

      const envId = task.env_id || project.default_env_id;
      if (!envId) throw new Error("No environment specified for task or project");

      const conn = adapterManager.getConnection(envId);
      if (!conn) throw new Error(`Environment ${envId} not connected`);

      const sessionId = uuid();
      const runtime = req.runtime || "claude-code";
      const model = req.model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      // Build system context: task info + review notes + MCP tool instructions
      const systemContext = [
        `## Task: ${task.title}`,
        task.description,
        task.review_notes ? `## Review Feedback (from previous attempt)\n${task.review_notes}` : "",
        `## Grackle Tools (MCP)`,
        `You have access to Grackle MCP tools for coordinating with other agents:`,
        `- **grackle_post_finding**: Share discoveries (architecture decisions, bugs, patterns) with other agents working on this project. Use categories: architecture, api, bug, decision, dependency, pattern, general.`,
        `- **grackle_query_findings**: Query findings posted by other agents. Filter by category or tags.`,
        `- **grackle_get_task**: Get details about your current task.`,
        `- **grackle_list_tasks**: See other tasks in the project and their status.`,
      ].filter(Boolean).join("\n\n");

      sessionStore.createSession(sessionId, envId, runtime, task.title, model, logPath);
      taskStore.setTaskSession(task.id, sessionId);
      taskStore.markTaskStarted(task.id);
      broadcast({ type: "task_started", payload: { taskId: task.id, sessionId, projectId: task.project_id } });

      spawnOnPowerLine(conn, sessionId, runtime, task.title, model, logPath,
        task.branch, systemContext, task.project_id, task.id,
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
            broadcast({ type: "task_updated", payload: { taskId: task.id, projectId: task.project_id } });
          }
        },
      );

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async approveTask(req) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new Error(`Task not found: ${req.id}`);

      taskStore.markTaskCompleted(task.id, "done");

      // Check for newly unblocked tasks
      const unblocked = taskStore.checkAndUnblock(task.project_id);
      for (const t of unblocked) {
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId: "",
          type: "system",
          timestamp: new Date().toISOString(),
          content: JSON.stringify({ type: "task_unblocked", taskId: t.id, title: t.title }),
          raw: "",
        }));
      }

      broadcast({ type: "task_approved", payload: { taskId: task.id, projectId: task.project_id } });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
    },

    async rejectTask(req) {
      const task = taskStore.getTask(req.id);
      if (!task) throw new Error(`Task not found: ${req.id}`);

      taskStore.updateTask(
        task.id, task.title, task.description, "assigned",
        task.env_id, JSON.parse(task.depends_on), req.reviewNotes || "",
      );

      broadcast({ type: "task_rejected", payload: { taskId: task.id, projectId: task.project_id } });
      const row = taskStore.getTask(task.id);
      return taskRowToProto(row!);
    },

    async deleteTask(req) {
      const task = taskStore.getTask(req.id);
      taskStore.deleteTask(req.id);
      broadcast({ type: "task_deleted", payload: { taskId: req.id, projectId: task?.project_id } });
      return create(grackle.EmptySchema, {});
    },

    // ─── Findings ────────────────────────────────────────────

    async postFinding(req) {
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

    async queryFindings(req) {
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

    async getTaskDiff(req) {
      const task = taskStore.getTask(req.taskId);
      if (!task) throw new Error(`Task not found: ${req.taskId}`);
      if (!task.branch) throw new Error("Task has no branch");

      const envId = task.env_id || projectStore.getProject(task.project_id)?.default_env_id;
      if (!envId) throw new Error("No environment for task");

      const conn = adapterManager.getConnection(envId);
      if (!conn) throw new Error(`Environment ${envId} not connected`);

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
