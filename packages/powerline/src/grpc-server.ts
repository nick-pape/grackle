import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  powerline,
} from "@grackle-ai/common";
import { getRuntime, listRuntimes } from "./runtime-registry.js";
import { addSession, getSession, removeSession, listAllSessions } from "./session-mgr.js";
import { writeTokens } from "./token-writer.js";
import { removeWorktree } from "./worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { AgentSession } from "./runtimes/runtime.js";

const execAsync: typeof execFile.__promisify__ = promisify(execFile);

const startTime: number = Date.now();

/** Stream events from an agent session as proto messages, cleaning up the session when done. */
async function *streamSession(sessionId: string, session: AgentSession): AsyncGenerator<powerline.AgentEvent> {
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
          })
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

    async getDiff(req: powerline.DiffRequest) {
      const baseBranch = req.baseBranch || "main";
      const basePath = req.worktreeBasePath || "/workspace";

      try {
        // Resolve worktree path for the branch (may differ from basePath)
        let diffCwd = basePath;
        try {
          const { stdout: wtList } = await execAsync(
            "git", ["worktree", "list", "--porcelain"],
            { cwd: basePath }
          );
          for (const block of wtList.split("\n\n")) {
            if (block.includes(`branch refs/heads/${req.branch}`)) {
              const pathMatch = block.match(/^worktree (.+)$/m);
              if (pathMatch) {
                diffCwd = pathMatch[1];
              }
              break;
            }
          }
        } catch { /* fall back to basePath */ }

        // Include both committed AND uncommitted changes vs base branch.
        // First add all untracked files so they appear in the diff.
        try {
          await execAsync("git", ["add", "-N", "."], { cwd: diffCwd });
        } catch { /* ignore */ }

        // Diff against the merge base (includes uncommitted working tree changes)
        const { stdout: mergeBase } = await execAsync(
          "git", ["merge-base", baseBranch, "HEAD"],
          { cwd: diffCwd }
        );
        const base = mergeBase.trim();

        const { stdout: diff } = await execAsync(
          "git", ["diff", base],
          { cwd: diffCwd, maxBuffer: 10 * 1024 * 1024 }
        );

        // Get changed files
        const { stdout: filesOut } = await execAsync(
          "git", ["diff", "--name-only", base],
          { cwd: diffCwd }
        );
        const changedFiles = filesOut.trim().split("\n").filter(Boolean);

        // Get stat
        const { stdout: statOut } = await execAsync(
          "git", ["diff", "--stat", base],
          { cwd: diffCwd }
        );
        const statMatch = statOut.match(/(\d+) insertion.+?(\d+) deletion/);
        const additions = statMatch ? parseInt(statMatch[1], 10) : 0;
        const deletions = statMatch ? parseInt(statMatch[2], 10) : 0;

        return create(powerline.DiffResponseSchema, {
          diff,
          changedFiles,
          additions,
          deletions,
        });
      } catch (err) {
        return create(powerline.DiffResponseSchema, {
          diff: `Error getting diff: ${err}`,
          changedFiles: [],
          additions: 0,
          deletions: 0,
        });
      }
    },
  });
}
