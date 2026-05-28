/**
 * Pure helpers for the createSession (AHP HR4+5) spawn shape: resolving the
 * runtime/model selection and mapping the reshaped `grackle.SpawnRequest`
 * `config` onto the host-transport `CreateSessionParams`. Kept free of I/O
 * (and of the core/database import graph) so the wire mapping is
 * unit-testable.
 *
 * @module
 */
import { grackle } from "@grackle-ai/common";
import type { CreateSessionParams } from "@grackle-ai/adapter-sdk";

/**
 * Resolve the runtime + model for a spawn, honoring explicit request overrides
 * (AHP createSession `provider`/`model`) over the resolved persona's defaults.
 */
export function resolveSpawnSelection(
  provider: string,
  modelId: string,
  persona: { runtime: string; model: string },
): { runtime: string; model: string } {
  return {
    runtime: provider || persona.runtime,
    model: modelId || persona.model,
  };
}

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
    branch: cfg?.branch ?? "",
    workingDirectory: args.workingDirectory,
    systemContext: args.systemContext,
    workspaceId: args.workspaceId || undefined,
    taskId: cfg?.taskId ?? "",
    mcpServersJson: args.mcpServersJson,
    mcpUrl: args.mcpUrl,
    mcpToken: args.mcpToken,
    scriptContent: args.scriptContent,
    useWorktrees: cfg?.useWorktrees,
    pipe: cfg?.pipe ?? "",
  };
}
