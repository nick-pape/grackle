import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { create } from "@bufbuild/protobuf";
import { grackle, sidecar } from "@grackle/common";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import { v4 as uuid } from "uuid";
import { homedir } from "node:os";
import { join } from "node:path";
import { GRACKLE_DIR, LOGS_DIR, DEFAULT_RUNTIME } from "@grackle/common";
import * as logWriter from "./log-writer.js";
import { writeTranscript } from "./transcript.js";

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  id?: string;
}

export function createWsBridge(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    const subscriptions: Array<{ cancel(): void }> = [];

    ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        await handleMessage(ws, msg, subscriptions);
      } catch (err) {
        sendWs(ws, { type: "error", payload: { message: String(err) } });
      }
    });

    ws.on("close", () => {
      for (const sub of subscriptions) sub.cancel();
    });

    // Ping/pong keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);

    ws.on("close", () => clearInterval(pingInterval));
  });

  return wss;
}

async function handleMessage(
  ws: WebSocket,
  msg: WsMessage,
  subscriptions: Array<{ cancel(): void }>
): Promise<void> {
  switch (msg.type) {
    case "list_environments": {
      const rows = envRegistry.listEnvironments();
      sendWs(ws, {
        type: "environments",
        payload: {
          environments: rows.map((r) => ({
            id: r.id,
            displayName: r.display_name,
            adapterType: r.adapter_type,
            defaultRuntime: r.default_runtime,
            status: r.status,
            bootstrapped: r.bootstrapped === 1,
          })),
        },
      });
      break;
    }

    case "list_sessions": {
      const envId = (msg.payload?.envId as string) || "";
      const status = (msg.payload?.status as string) || "";
      const rows = sessionStore.listSessions(envId, status);
      sendWs(ws, {
        type: "sessions",
        payload: {
          sessions: rows.map((r) => ({
            id: r.id,
            envId: r.env_id,
            runtime: r.runtime,
            status: r.status,
            prompt: r.prompt,
            startedAt: r.started_at,
          })),
        },
      });
      break;
    }

    case "subscribe": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) return;

      const stream = streamHub.createStream(sessionId);
      subscriptions.push(stream);

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
      const stream = streamHub.createGlobalStream();
      subscriptions.push(stream);

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
      const envId = msg.payload?.envId as string;
      const prompt = msg.payload?.prompt as string;
      const model = (msg.payload?.model as string) || "";
      const runtime = (msg.payload?.runtime as string) || "";

      if (!envId || !prompt) {
        sendWs(ws, { type: "error", payload: { message: "envId and prompt required" } });
        return;
      }

      const env = envRegistry.getEnvironment(envId);
      if (!env) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${envId}` } });
        return;
      }

      const active = sessionStore.getActiveForEnv(envId);
      if (active) {
        sendWs(ws, { type: "error", payload: { message: `Env already has active session: ${active.id}` } });
        return;
      }

      const conn = adapterManager.getConnection(envId);
      if (!conn) {
        sendWs(ws, { type: "error", payload: { message: `Environment not connected: ${envId}` } });
        return;
      }

      const sessionId = uuid();
      const sessionRuntime = runtime || env.default_runtime || DEFAULT_RUNTIME;
      const sessionModel = model || "claude-sonnet-4-5-20250514";
      const logPath = join(homedir(), GRACKLE_DIR, LOGS_DIR, sessionId);

      sessionStore.createSession(sessionId, envId, sessionRuntime, prompt, sessionModel, logPath);
      logWriter.initLog(logPath);

      sendWs(ws, { type: "spawned", payload: { sessionId } });

      // Fire sidecar spawn in background
      const sidecarReq = create(sidecar.SpawnRequestSchema, {
        sessionId,
        runtime: sessionRuntime,
        prompt,
        model: sessionModel,
        maxTurns: 0,
      });

      (async () => {
        try {
          sessionStore.updateSession(sessionId, "running");
          for await (const event of conn.client.spawn(sidecarReq)) {
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
        }
      })();
      break;
    }

    case "send_input": {
      const sessionId = msg.payload?.sessionId as string;
      const text = msg.payload?.text as string;
      if (!sessionId || !text) return;

      const session = sessionStore.getSession(sessionId);
      if (!session) return;

      const conn = adapterManager.getConnection(session.env_id);
      if (!conn) return;

      await conn.client.sendInput(
        create(sidecar.InputMessageSchema, { sessionId, text })
      );
      break;
    }

    case "kill": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) return;

      const session = sessionStore.getSession(sessionId);
      if (!session) return;

      const conn = adapterManager.getConnection(session.env_id);
      if (conn) {
        await conn.client.kill(create(sidecar.SessionIdSchema, { id: sessionId }));
      }
      sessionStore.updateSession(sessionId, "killed");
      break;
    }
  }
}

function sendWs(ws: WebSocket, msg: { type: string; payload?: Record<string, unknown> }): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
