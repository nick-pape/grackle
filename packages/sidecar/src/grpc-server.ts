import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { sidecar } from "@grackle/common";
import { getRuntime, listRuntimes } from "./runtime-registry.js";
import { addSession, getSession, listAllSessions } from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";
import { removeWorktree } from "./worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execAsync = promisify(execFile);

const startTime = Date.now();

export function registerSidecarRoutes(router: ConnectRouter): void {
  router.service(sidecar.GrackleSidecar, {
    async getInfo() {
      return create(sidecar.EnvInfoSchema, {
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
        branch: req.branch || undefined,
        worktreeBasePath: req.worktreeBasePath || undefined,
        systemContext: req.systemContext || undefined,
        projectId: req.projectId || undefined,
        taskId: req.taskId || undefined,
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
            runtime: s.runtimeSessionId,
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

    async cleanupWorktree(req) {
      if (req.branch && req.worktreeBasePath) {
        await removeWorktree(req.worktreeBasePath, req.branch);
      }
      return create(sidecar.EmptySchema, {});
    },

    async getDiff(req) {
      const baseBranch = req.baseBranch || "main";
      const basePath = req.worktreeBasePath || "/workspace";

      try {
        // Get the diff
        const { stdout: diff } = await execAsync(
          "git", ["diff", `${baseBranch}...${req.branch}`],
          { cwd: basePath, maxBuffer: 10 * 1024 * 1024 }
        );

        // Get changed files
        const { stdout: filesOut } = await execAsync(
          "git", ["diff", "--name-only", `${baseBranch}...${req.branch}`],
          { cwd: basePath }
        );
        const changedFiles = filesOut.trim().split("\n").filter(Boolean);

        // Get stat
        const { stdout: statOut } = await execAsync(
          "git", ["diff", "--stat", `${baseBranch}...${req.branch}`],
          { cwd: basePath }
        );
        const statMatch = statOut.match(/(\d+) insertion.+?(\d+) deletion/);
        const additions = statMatch ? parseInt(statMatch[1], 10) : 0;
        const deletions = statMatch ? parseInt(statMatch[2], 10) : 0;

        return create(sidecar.DiffResponseSchema, {
          diff,
          changedFiles,
          additions,
          deletions,
        });
      } catch (err) {
        return create(sidecar.DiffResponseSchema, {
          diff: `Error getting diff: ${err}`,
          changedFiles: [],
          additions: 0,
          deletions: 0,
        });
      }
    },
  });
}
