import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import { getRuntime, listRuntimes } from "./runtime-registry.js";
import {
  addSession,
  getSession,
  removeSession,
  listAllSessions,
} from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";
import { removeWorktree } from "./worktree.js";
import os from "node:os";
import type { AgentSession } from "./runtimes/runtime.js";

const startTime: number = Date.now();

/** Stream events from an agent session as proto messages, cleaning up the session when done. */
async function* streamSession(
  sessionId: string,
  session: AgentSession,
): AsyncGenerator<powerline.AgentEvent> {
  addSession(session);
  try {
    for await (const event of session.stream()) {
      yield create(powerline.AgentEventSchema, {
        sessionId,
        type: event.type,
        timestamp: event.timestamp,
        content: event.content,
        raw: event.raw ? JSON.stringify(event.raw) : "",
      });
    }
  } finally {
    removeSession(sessionId);
  }
}

/** Register all PowerLine gRPC service handlers on the given ConnectRPC router. */
export function registerPowerLineRoutes(router: ConnectRouter): void {
  router.service(powerline.GracklePowerLine, {
    async getInfo() {
      return create(powerline.EnvironmentInfoSchema, {
        hostname: os.hostname(),
        os: `${os.platform()} ${os.release()}`,
        nodeVersion: process.version,
        availableRuntimes: listRuntimes(),
        uptimeSeconds: BigInt(Math.floor((Date.now() - startTime) / 1000)),
      });
    },

    async *spawn(req: powerline.SpawnRequest) {
      const runtime = getRuntime(req.runtime);
      if (!runtime) {
        yield create(powerline.AgentEventSchema, {
          sessionId: req.sessionId,
          type: "error",
          timestamp: new Date().toISOString(),
          content: `Unknown runtime: ${req.runtime}`,
        });
        return;
      }

      // Pass through MCP URL + scoped token from the server (no local broker needed).
      let mcpBroker: { url: string; token: string } | undefined;
      if (req.mcpUrl && req.mcpToken) {
        mcpBroker = { url: req.mcpUrl, token: req.mcpToken };
      }

      const session = runtime.spawn({
        sessionId: req.sessionId,
        prompt: req.prompt,
        model: req.model,
        maxTurns: req.maxTurns,
        branch: req.branch || undefined,
        worktreeBasePath: req.worktreeBasePath || undefined,
        useWorktrees: req.useWorktrees ?? undefined,
        systemContext: req.systemContext || undefined,
        workspaceId: req.workspaceId || undefined,
        taskId: req.taskId || undefined,
        mcpServers: req.mcpServersJson
          ? (JSON.parse(req.mcpServersJson) as Record<string, unknown>)
          : undefined,
        mcpBroker,
        scriptContent: req.scriptContent || undefined,
        pipe: (req.pipe || undefined) as import("@grackle-ai/common").PipeMode | undefined,
      });

      yield* streamSession(req.sessionId, session);
    },

    async *resume(req: powerline.ResumeRequest) {
      const runtime = getRuntime(req.runtime);
      if (!runtime) {
        yield create(powerline.AgentEventSchema, {
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

      yield* streamSession(req.sessionId, session);
    },

    async sendInput(req: powerline.InputMessage) {
      const session = getSession(req.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${req.sessionId}`);
      }
      session.sendInput(req.text);
      return create(powerline.EmptySchema, {});
    },

    async kill(req: powerline.SessionId) {
      const session = getSession(req.id);
      if (!session) {
        throw new Error(`Session not found: ${req.id}`);
      }
      session.kill();
      return create(powerline.EmptySchema, {});
    },

    async listSessions() {
      const sessions = listAllSessions();
      return create(powerline.SessionListSchema, {
        sessions: sessions.map((s) =>
          create(powerline.SessionInfoSchema, {
            sessionId: s.id,
            runtime: s.runtimeName,
            status: s.status,
          }),
        ),
      });
    },

    async ping() {
      return create(powerline.PongSchema, {
        timestamp: BigInt(Date.now()),
      });
    },

    async pushTokens(req: powerline.TokenBundle) {
      const tokens = req.tokens.map((t) => ({
        name: t.name,
        type: t.type,
        envVar: t.envVar,
        filePath: t.filePath,
        value: t.value,
      }));
      await writeTokens(tokens);
      return create(powerline.EmptySchema, {});
    },

    async cleanupWorktree(req: powerline.WorktreeCleanupRequest) {
      if (req.branch && req.worktreeBasePath) {
        await removeWorktree(req.worktreeBasePath, req.branch);
      }
      return create(powerline.EmptySchema, {});
    },

    async *drainBufferedEvents(_req: powerline.DrainRequest) {
      // Stub — real implementation in #750 (session parking).
      // Yields nothing (empty stream) until parking is implemented.
    },
  });
}
