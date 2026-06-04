/**
 * Pure helper for mapping the reshaped `grackle.SpawnRequest` `config` onto
 * the host-transport `CreateSessionParams`. Kept free of I/O (and of the
 * core/database import graph) so the wire mapping is unit-testable.
 *
 * Runtime/model/maxTurns/workingDirectory/useWorktrees cascade resolution
 * lives in `@grackle-ai/core`'s `resolveSpawnSpec` (#1427).
 *
 * @module
 */
import { grackle } from "@grackle-ai/common";
import type { CreateSessionParams } from "@grackle-ai/adapter-sdk";

/** Server-resolved values for a spawn that don't come from the client `config`. */
export interface CreateSessionInputs {
  sessionId: string;
  runtime: string;
  model: string;
  prompt: string;
  maxTurns: number;
  config: grackle.SessionConfig | undefined;
  systemContext: string;
  mcpServersJson: string;
  mcpUrl: string;
  mcpToken: string;
  scriptContent: string;
  workingDirectory: string;
  /** Already-resolved workspace id (incl. parent-session/task inheritance); "" = none. */
  workspaceId: string;
  /** Git branch override — takes precedence over `config.branch`. Used by the task path where branch comes from the task row, not the client config. */
  branch?: string;
  /** Worktree override — takes precedence over `config.useWorktrees`. */
  useWorktrees?: boolean;
  /** Task ID override — takes precedence over `config.taskId`. */
  taskId?: string;
  /** Pipe mode override — takes precedence over `config.pipe`. */
  pipe?: string;
}

/**
 * Build the host-transport `CreateSessionParams` from a (reshaped) createSession
 * `config` plus server-resolved values. Pure (no I/O) so the config→params
 * mapping — including `task_id` plumbing and the optional `use_worktrees`
 * passthrough — is unit-testable in isolation from `spawnAgent`'s side effects.
 */
export function buildCreateSessionParams(args: CreateSessionInputs): CreateSessionParams {
  const cfg = args.config;
  return {
    sessionId: args.sessionId,
    runtime: args.runtime,
    prompt: args.prompt,
    model: args.model,
    maxTurns: args.maxTurns,
    branch: args.branch ?? cfg?.branch ?? "",
    workingDirectory: args.workingDirectory,
    systemContext: args.systemContext,
    workspaceId: args.workspaceId || undefined,
    taskId: args.taskId ?? cfg?.taskId ?? "",
    mcpServersJson: args.mcpServersJson,
    mcpUrl: args.mcpUrl,
    mcpToken: args.mcpToken,
    scriptContent: args.scriptContent,
    useWorktrees: args.useWorktrees ?? cfg?.useWorktrees,
    pipe: args.pipe ?? cfg?.pipe ?? "",
  };
}
