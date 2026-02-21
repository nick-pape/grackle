import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { sidecar } from "@grackle/common";
import { getRuntime, listRuntimes } from "./runtime-registry.js";
import { addSession, getSession, listAllSessions } from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";
import os from "node:os";

const startTime = Date.now();

export function registerSidecarRoutes(router: ConnectRouter): void {
  router.service(sidecar.GrackleSidecar, {
    async getInfo() {
      return create(sidecar.EnvironmentInfoSchema, {
        hostname: os.hostname(),
        os: `${os.platform()} ${os.release()}`,
        nodeVersion: process.version,
        availableRuntimes: listRuntimes(),
        uptimeSeconds: BigInt(Math.floor((Date.now() - startTime) / 1000)),
      });
    },

    async *spawn(req) {
      const runtime = getRuntime(req.runtime);
      if (!runtime) {
        yield create(sidecar.AgentEventSchema, {
          sessionId: req.sessionId,
          type: "error",
          timestamp: new Date().toISOString(),
          content: `Unknown runtime: ${req.runtime}`,
        });
        return;
      }

      const session = runtime.spawn({
        sessionId: req.sessionId,
        prompt: req.prompt,
        model: req.model,
        maxTurns: req.maxTurns,
      });

      addSession(session);

      for await (const event of session.stream()) {
        yield create(sidecar.AgentEventSchema, {
          sessionId: req.sessionId,
          type: event.type,
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw ? JSON.stringify(event.raw) : "",
        });
      }
    },

    async *resume(req) {
      const runtime = getRuntime(req.runtime);
      if (!runtime) {
        yield create(sidecar.AgentEventSchema, {
          sessionId: req.sessionId,
          type: "error",
          timestamp: new Date().toISOString(),
          content: `Unknown runtime: ${req.runtime}`,
        });
        return;
      }

      const session = runtime.resume({
        sessionId: req.sessionId,
        runtimeSessionId: req.runtimeSessionId,
      });

      addSession(session);

      for await (const event of session.stream()) {
        yield create(sidecar.AgentEventSchema, {
          sessionId: req.sessionId,
          type: event.type,
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw ? JSON.stringify(event.raw) : "",
        });
      }
    },

    async sendInput(req) {
      const session = getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }
      session.sendInput(req.text);
      return create(sidecar.EmptySchema, {});
    },

    async kill(req) {
      const session = getSession(req.id);
      if (!session) {
        throw new Error(`Session not found: ${req.id}`);
      }
      session.kill();
      return create(sidecar.EmptySchema, {});
    },

    async listSessions() {
      const sessions = listAllSessions();
      return create(sidecar.SessionListSchema, {
        sessions: sessions.map((s) =>
          create(sidecar.SessionInfoSchema, {
            sessionId: s.id,
            runtime: s.runtimeName,
            status: s.status,
          })
        ),
      });
    },

    async ping() {
      return create(sidecar.PongSchema, {
        timestamp: BigInt(Date.now()),
      });
    },

    async pushTokens(req) {
      await writeTokens(req.tokens);
      return create(sidecar.EmptySchema, {});
    },
  });
}
