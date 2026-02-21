import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, sidecar } from "@grackle/common";
import { v4 as uuid } from "uuid";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as logWriter from "./log-writer.js";
import { writeTranscript } from "./transcript.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { GRACKLE_DIR, LOGS_DIR, DEFAULT_RUNTIME } from "@grackle/common";

function envRowToProto(row: envRegistry.EnvironmentRow): grackle.Environment {
  return create(grackle.EnvironmentSchema, {
    id: row.id,
    displayName: row.display_name,
    adapterType: row.adapter_type,
    adapterConfig: row.adapter_config,
    defaultRuntime: row.default_runtime,
    bootstrapped: row.bootstrapped === 1,
    status: row.status,
    lastSeen: row.last_seen || "",
    envInfo: row.env_info || "",
    createdAt: row.created_at,
  });
}

function sessionRowToProto(row: sessionStore.SessionRow): grackle.Session {
  return create(grackle.SessionSchema, {
    id: row.id,
    envId: row.env_id,
    runtime: row.runtime,
    runtimeSessionId: row.runtime_session_id || "",
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    logPath: row.log_path || "",
    turns: row.turns,
    startedAt: row.started_at,
    suspendedAt: row.suspended_at || "",
    endedAt: row.ended_at || "",
    error: row.error || "",
  });
}

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

      const adapter = adapterManager.getAdapter(env.adapter_type);
      if (!adapter) {
        yield create(grackle.ProvisionEventSchema, {
          stage: "error",
          message: `No adapter for type: ${env.adapter_type}`,
          progress: 0,
        });
        return;
      }

      envRegistry.updateEnvironmentStatus(req.id, "connecting");

      const config = JSON.parse(env.adapter_config);
      for await (const event of adapter.provision(req.id, config)) {
        yield create(grackle.ProvisionEventSchema, {
          stage: event.stage,
          message: event.message,
          progress: event.progress,
        });
      }

      try {
        const conn = await adapter.connect(req.id, config);
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
      if (!env) throw new Error(`Environment not found: ${req.id}`);

      const adapter = adapterManager.getAdapter(env.adapter_type);
      if (adapter) {
        await adapter.stop(req.id, JSON.parse(env.adapter_config));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      return create(grackle.EmptySchema, {});
    },

    async destroyEnvironment(req) {
      const env = envRegistry.getEnvironment(req.id);
      if (!env) throw new Error(`Environment not found: ${req.id}`);

      const adapter = adapterManager.getAdapter(env.adapter_type);
      if (adapter) {
        await adapter.destroy(req.id, JSON.parse(env.adapter_config));
      }
      adapterManager.removeConnection(req.id);
      envRegistry.updateEnvironmentStatus(req.id, "disconnected");
      return create(grackle.EmptySchema, {});
    },

    async spawnAgent(req) {
      const env = envRegistry.getEnvironment(req.envId);
      if (!env) throw new Error(`Environment not found: ${req.envId}`);

      // One agent per env (V0)
      const active = sessionStore.getActiveForEnv(req.envId);
      if (active) {
        throw new Error(`Environment ${req.envId} already has an active session: ${active.id}`);
      }

      const conn = adapterManager.getConnection(req.envId);
      if (!conn) throw new Error(`Environment ${req.envId} not connected`);

      const sessionId = uuid();
      const runtime = req.runtime || env.default_runtime;
      const model = req.model || "claude-sonnet-4-5-20250514";
      const logPath = join(homedir(), GRACKLE_DIR, LOGS_DIR, sessionId);

      sessionStore.createSession(sessionId, req.envId, runtime, req.prompt, model, logPath);

      // Start streaming from sidecar in background
      const sidecarReq = create(sidecar.SpawnRequestSchema, {
        sessionId,
        runtime,
        prompt: req.prompt,
        model,
        maxTurns: req.maxTurns || 0,
      });

      // Initialize log writer
      logWriter.initLog(logPath);

      // Fire off sidecar stream and pipe to stream hub + log writer
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
              if (event.content === "waiting_input") {
                sessionStore.updateSessionStatus(sessionId, "waiting_input");
              } else if (event.content === "running") {
                sessionStore.updateSessionStatus(sessionId, "running");
              } else if (event.content === "completed") {
                sessionStore.updateSession(sessionId, "completed");
              }
            }
          }

          // Stream ended — mark completed if not already
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

      const row = sessionStore.getSession(sessionId);
      return sessionRowToProto(row!);
    },

    async resumeAgent(req) {
      const session = sessionStore.getSession(req.sessionId);
      if (!session) throw new Error(`Session not found: ${req.sessionId}`);

      const conn = adapterManager.getConnection(session.env_id);
      if (!conn) throw new Error(`Environment ${session.env_id} not connected`);

      const sidecarReq = create(sidecar.ResumeRequestSchema, {
        sessionId: session.id,
        runtimeSessionId: session.runtime_session_id || "",
        runtime: session.runtime,
      });

      (async () => {
        try {
          sessionStore.updateSession(session.id, "running");
          for await (const event of conn.client.resume(sidecarReq)) {
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
      if (!session) throw new Error(`Session not found: ${req.sessionId}`);
      if (session.status !== "waiting_input") {
        throw new Error(`Session ${req.sessionId} is not waiting for input (status: ${session.status})`);
      }

      const conn = adapterManager.getConnection(session.env_id);
      if (!conn) throw new Error(`Environment ${session.env_id} not connected`);

      await conn.client.sendInput(
        create(sidecar.InputMessageSchema, {
          sessionId: req.sessionId,
          text: req.text,
        })
      );

      return create(grackle.EmptySchema, {});
    },

    async killAgent(req) {
      const session = sessionStore.getSession(req.id);
      if (!session) throw new Error(`Session not found: ${req.id}`);

      const conn = adapterManager.getConnection(session.env_id);
      if (conn) {
        await conn.client.kill(
          create(sidecar.SessionIdSchema, { id: req.id })
        );
      }

      sessionStore.updateSession(req.id, "killed");
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
      const tokens = tokenBroker.listTokens();
      return create(grackle.TokenListSchema, {
        tokens: tokens.map((t) =>
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
  });
}
