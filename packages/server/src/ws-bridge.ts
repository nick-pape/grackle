import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle/common";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as projectStore from "./project-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { LOGS_DIR, DEFAULT_RUNTIME, DEFAULT_MODEL } from "@grackle/common";
import { grackleHome } from "./paths.js";
import * as logWriter from "./log-writer.js";
import { writeTranscript } from "./transcript.js";

const WS_PING_INTERVAL_MS = 30_000;
const WS_CLOSE_UNAUTHORIZED = 4001;

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  id?: string;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

let wssInstance: WebSocketServer | null = null;

/** Broadcast a message to all connected WS clients. */
export function broadcast(msg: { type: string; payload?: Record<string, unknown> }): void {
  if (!wssInstance) return;
  const data = JSON.stringify(msg);
  for (const client of wssInstance.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}

/** Create a WebSocket server on top of an HTTP server that bridges JSON messages to gRPC operations. */
export function createWsBridge(httpServer: HttpServer, verifyApiKey: (token: string) => boolean): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });
  wssInstance = wss;

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token") || "";
    if (!verifyApiKey(token)) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    const subscriptions = new Map<string, { cancel(): void }>();

    ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        await handleMessage(ws, msg, subscriptions);
      } catch (err) {
        sendWs(ws, { type: "error", payload: { message: String(err) } });
      }
    });

    ws.on("close", () => {
      for (const sub of subscriptions.values()) {
        sub.cancel();
      }
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, WS_PING_INTERVAL_MS);

    ws.on("close", () => clearInterval(pingInterval));
  });

  return wss;
}

async function handleMessage(
  ws: WebSocket,
  msg: WsMessage,
  subscriptions: Map<string, { cancel(): void }>,
): Promise<void> {
  switch (msg.type) {
    case "list_environments": {
      const rows = envRegistry.listEnvironments();
      sendWs(ws, {
        type: "environments",
        payload: {
          environments: rows.map((r) => ({
            id: r.id,
            displayName: r.displayName,
            adapterType: r.adapterType,
            defaultRuntime: r.defaultRuntime,
            status: r.status,
            bootstrapped: r.bootstrapped,
          })),
        },
      });
      break;
    }

    case "list_sessions": {
      const environmentId = (msg.payload?.environmentId as string) || "";
      const status = (msg.payload?.status as string) || "";
      const rows = sessionStore.listSessions(environmentId, status);
      sendWs(ws, {
        type: "sessions",
        payload: {
          sessions: rows.map((r) => ({
            id: r.id,
            environmentId: r.environmentId,
            runtime: r.runtime,
            status: r.status,
            prompt: r.prompt,
            startedAt: r.startedAt,
          })),
        },
      });
      break;
    }

    case "get_session_events": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session || !session.logPath) {
        return;
      }

      const entries = logWriter.readLog(session.logPath);
      const events = entries.map((e) => ({
        sessionId: e.session_id,
        eventType: e.type,
        timestamp: e.timestamp,
        content: e.content,
      }));

      sendWs(ws, { type: "session_events", payload: { sessionId, events } });
      break;
    }

    case "subscribe": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      // Cancel any existing subscription for this session
      const subKey = `session:${sessionId}`;
      const existing = subscriptions.get(subKey);
      if (existing) {
        subscriptions.delete(subKey);
        existing.cancel();
      }

      const stream = streamHub.createStream(sessionId);
      subscriptions.set(subKey, stream);

      (async () => {
        for await (const event of stream) {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId: event.sessionId,
              eventType: event.type,
              timestamp: event.timestamp,
              content: event.content,
            },
          });
        }
      })();
      break;
    }

    case "subscribe_all": {
      // Cancel any existing global subscription
      const existingGlobal = subscriptions.get("global");
      if (existingGlobal) {
        subscriptions.delete("global");
        existingGlobal.cancel();
      }

      const stream = streamHub.createGlobalStream();
      subscriptions.set("global", stream);

      (async () => {
        for await (const event of stream) {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId: event.sessionId,
              eventType: event.type,
              timestamp: event.timestamp,
              content: event.content,
            },
          });
        }
      })();
      break;
    }

    case "spawn": {
      const environmentId = msg.payload?.environmentId as string;
      const prompt = msg.payload?.prompt as string;
      const model = (msg.payload?.model as string) || "";
      const runtime = (msg.payload?.runtime as string) || "";
      const branch = (msg.payload?.branch as string) || "";
      const systemContext = (msg.payload?.systemContext as string) || "";

      if (!environmentId || !prompt) {
        sendWs(ws, { type: "error", payload: { message: "environmentId and prompt required" } });
        return;
      }

      const env = envRegistry.getEnvironment(environmentId);
      if (!env) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${environmentId}` } });
        return;
      }

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) {
        sendWs(ws, { type: "error", payload: { message: `Environment not connected: ${environmentId}` } });
        return;
      }

      const sessionId = uuid();
      const sessionRuntime = runtime || env.defaultRuntime || DEFAULT_RUNTIME;
      const sessionModel = model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      sessionStore.createSession(sessionId, environmentId, sessionRuntime, prompt, sessionModel, logPath);
      logWriter.initLog(logPath);

      sendWs(ws, { type: "spawned", payload: { sessionId } });

      // Fire PowerLine spawn in background
      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime: sessionRuntime,
        prompt,
        model: sessionModel,
        maxTurns: 0,
        branch,
        worktreeBasePath: branch ? "/workspace" : "",
        systemContext,
      });

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
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId,
              eventType: "error",
              timestamp: new Date().toISOString(),
              content: `Spawn failed: ${err}`,
            },
          });
        } finally {
          logWriter.endSession(logPath);
          try {
            writeTranscript(logPath);
          } catch {
            /* non-critical */
          }
        }
      })();
      break;
    }

    case "send_input": {
      const sessionId = msg.payload?.sessionId as string;
      const text = msg.payload?.text as string;
      if (!sessionId || !text) {
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return;
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        return;
      }

      await conn.client.sendInput(
        create(powerline.InputMessageSchema, { sessionId, text })
      );
      break;
    }

    case "kill": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return;
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (conn) {
        try {
          await conn.client.kill(create(powerline.SessionIdSchema, { id: sessionId }));
        } catch (err) {
          sendWs(ws, { type: "error", payload: { message: `Kill failed: ${err}` } });
          return;
        }
      }
      sessionStore.updateSession(sessionId, "killed");
      streamHub.publish(create(grackle.SessionEventSchema, {
        sessionId,
        type: "status",
        timestamp: new Date().toISOString(),
        content: "killed",
        raw: "",
      }));
      break;
    }

    // ─── Projects ──────────────────────────────────────────

    case "list_projects": {
      const rows = projectStore.listProjects();
      sendWs(ws, {
        type: "projects",
        payload: {
          projects: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            repoUrl: r.repoUrl,
            defaultEnvironmentId: r.defaultEnvironmentId,
            status: r.status,
            createdAt: r.createdAt,
          })),
        },
      });
      break;
    }

    case "create_project": {
      const name = msg.payload?.name as string;
      if (!name) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      const id = slugify(name) || uuid().slice(0, 8);
      projectStore.createProject(
        id, name,
        (msg.payload?.description as string) || "",
        (msg.payload?.repoUrl as string) || "",
        (msg.payload?.defaultEnvironmentId as string) || "",
      );
      const row = projectStore.getProject(id);
      broadcast({ type: "project_created", payload: { project: row } });
      break;
    }

    case "archive_project": {
      const projectId = msg.payload?.projectId as string;
      if (projectId) projectStore.archiveProject(projectId);
      broadcast({ type: "project_archived", payload: { projectId } });
      break;
    }

    // ─── Tasks ─────────────────────────────────────────────

    case "list_tasks": {
      const projectId = msg.payload?.projectId as string;
      if (!projectId) return;
      const rows = taskStore.listTasks(projectId);
      sendWs(ws, {
        type: "tasks",
        payload: {
          projectId,
          tasks: rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            title: r.title,
            description: r.description,
            status: r.status,
            branch: r.branch,
            environmentId: r.environmentId,
            sessionId: r.sessionId,
            dependsOn: JSON.parse(r.dependsOn),
            reviewNotes: r.reviewNotes,
            sortOrder: r.sortOrder,
            createdAt: r.createdAt,
          })),
        },
      });
      break;
    }

    case "create_task": {
      const projectId = msg.payload?.projectId as string;
      const title = msg.payload?.title as string;
      if (!projectId || !title) {
        sendWs(ws, { type: "error", payload: { message: "projectId and title required" } });
        return;
      }
      const project = projectStore.getProject(projectId);
      if (!project) {
        sendWs(ws, { type: "error", payload: { message: `Project not found: ${projectId}` } });
        return;
      }
      const id = uuid().slice(0, 8);
      taskStore.createTask(
        id, projectId, title,
        (msg.payload?.description as string) || "",
        (msg.payload?.environmentId as string) || project.defaultEnvironmentId,
        (msg.payload?.dependsOn as string[]) || [],
        slugify(project.name),
      );
      const row = taskStore.getTask(id);
      broadcast({ type: "task_created", payload: { task: row ? { ...row, dependsOn: JSON.parse(row.dependsOn) } : null } });
      break;
    }

    case "start_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task) {
        sendWs(ws, { type: "error", payload: { message: `Task not found: ${taskId}` } });
        return;
      }
      if (!["pending", "assigned"].includes(task.status)) {
        sendWs(ws, { type: "error", payload: { message: `Task cannot be started (status: ${task.status})` } });
        return;
      }
      if (!taskStore.areDependenciesMet(taskId)) {
        sendWs(ws, { type: "error", payload: { message: "Task has unmet dependencies" } });
        return;
      }

      const project = projectStore.getProject(task.projectId);
      if (!project) {
        sendWs(ws, { type: "error", payload: { message: `Project not found: ${task.projectId}` } });
        return;
      }

      const environmentId = task.environmentId || project.defaultEnvironmentId;
      const conn = adapterManager.getConnection(environmentId);
      if (!conn) {
        sendWs(ws, { type: "error", payload: { message: `Environment ${environmentId} not connected` } });
        return;
      }

      const sessionId = uuid();
      const runtime = (msg.payload?.runtime as string) || "claude-code";
      const model = (msg.payload?.model as string) || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

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
      logWriter.initLog(logPath);

      broadcast({ type: "task_started", payload: { taskId: task.id, sessionId, projectId: task.projectId } });

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: task.title,
        model,
        maxTurns: 0,
        branch: task.branch,
        worktreeBasePath: task.branch ? (process.env.GRACKLE_WORKTREE_BASE || "/workspace") : "",
        systemContext,
        projectId: task.projectId,
        taskId: task.id,
      });

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
            streamHub.publish(sessionEvent);

            // Intercept finding events and store + broadcast them
            if (event.type === "finding" && task.projectId) {
              try {
                const data = JSON.parse(event.content);
                const findingId = uuid();
                findingStore.postFinding(
                  findingId, task.projectId, task.id, sessionId,
                  data.category || "general", data.title || "Untitled",
                  data.content || "", data.tags || [],
                );
                broadcast({ type: "finding_posted", payload: { projectId: task.projectId, findingId } });
                process.stderr.write(`[finding] Stored: ${findingId} "${data.title}" in ${task.projectId}\n`);
              } catch (err) {
                process.stderr.write(`[finding] ERROR: ${err} (project=${task.projectId} task=${task.id})\n`);
              }
            }

            if (event.type === "status") {
              if (event.content === "waiting_input") sessionStore.updateSessionStatus(sessionId, "waiting_input");
              else if (event.content === "running") sessionStore.updateSessionStatus(sessionId, "running");
              else if (event.content === "completed") sessionStore.updateSession(sessionId, "completed");
            }
          }
          const current = sessionStore.getSession(sessionId);
          if (current && !["completed", "failed", "killed"].includes(current.status)) {
            sessionStore.updateSession(sessionId, "completed");
          }
        } catch (err) {
          sessionStore.updateSession(sessionId, "failed", undefined, String(err));
        } finally {
          logWriter.endSession(logPath);
          try { writeTranscript(logPath); } catch { /* non-critical */ }
          // Auto-move task to review on completion
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
        }
      })();
      break;
    }

    case "approve_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      taskStore.markTaskCompleted(taskId, "done");
      const task = taskStore.getTask(taskId);
      const unblocked = task ? taskStore.checkAndUnblock(task.projectId) : [];
      sendWs(ws, {
        type: "task_approved",
        payload: {
          taskId,
          unblockedTaskIds: unblocked.map((t) => t.id),
        },
      });
      break;
    }

    case "reject_task": {
      const taskId = msg.payload?.taskId as string;
      const reviewNotes = (msg.payload?.reviewNotes as string) || "";
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (task) {
        taskStore.updateTask(
          task.id, task.title, task.description, "assigned",
          task.environmentId, JSON.parse(task.dependsOn), reviewNotes,
        );
      }
      broadcast({ type: "task_rejected", payload: { taskId } });
      break;
    }

    case "delete_task": {
      const taskId = msg.payload?.taskId as string;
      if (taskId) taskStore.deleteTask(taskId);
      broadcast({ type: "task_deleted", payload: { taskId } });
      break;
    }

    // ─── Findings ──────────────────────────────────────────

    case "list_findings": {
      const projectId = msg.payload?.projectId as string;
      if (!projectId) return;
      const rows = findingStore.queryFindings(
        projectId,
        (msg.payload?.categories as string[]) || undefined,
        (msg.payload?.tags as string[]) || undefined,
        (msg.payload?.limit as number) || undefined,
      );
      sendWs(ws, {
        type: "findings",
        payload: {
          projectId,
          findings: rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            taskId: r.taskId,
            sessionId: r.sessionId,
            category: r.category,
            title: r.title,
            content: r.content,
            tags: JSON.parse(r.tags),
            createdAt: r.createdAt,
          })),
        },
      });
      break;
    }

    case "post_finding": {
      const projectId = msg.payload?.projectId as string;
      const title = msg.payload?.title as string;
      if (!projectId || !title) {
        sendWs(ws, { type: "error", payload: { message: "projectId and title required" } });
        return;
      }
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id, projectId,
        (msg.payload?.taskId as string) || "",
        (msg.payload?.sessionId as string) || "",
        (msg.payload?.category as string) || "general",
        title,
        (msg.payload?.content as string) || "",
        (msg.payload?.tags as string[]) || [],
      );
      sendWs(ws, { type: "finding_posted", payload: { id, projectId } });
      break;
    }

    // ─── Diff ──────────────────────────────────────────────

    case "get_task_diff": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task || !task.branch) {
        sendWs(ws, { type: "task_diff", payload: { taskId, error: "No branch" } });
        return;
      }

      const environmentId = task.environmentId || projectStore.getProject(task.projectId)?.defaultEnvironmentId;
      if (!environmentId) {
        sendWs(ws, { type: "task_diff", payload: { taskId, error: "No environment" } });
        return;
      }

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) {
        sendWs(ws, { type: "task_diff", payload: { taskId, error: "Environment not connected" } });
        return;
      }

      try {
        const diffResp = await conn.client.getDiff(
          create(powerline.DiffRequestSchema, {
            branch: task.branch,
            baseBranch: "main",
            worktreeBasePath: "/workspace",
          })
        );
        sendWs(ws, {
          type: "task_diff",
          payload: {
            taskId,
            branch: task.branch,
            diff: diffResp.diff,
            changedFiles: [...diffResp.changedFiles],
            additions: diffResp.additions,
            deletions: diffResp.deletions,
          },
        });
      } catch (err) {
        sendWs(ws, { type: "task_diff", payload: { taskId, error: String(err) } });
      }
      break;
    }
  }
}

function sendWs(ws: WebSocket, msg: { type: string; payload?: Record<string, unknown> }): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
