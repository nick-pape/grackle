/**
 * Single declared cascade for the per-spawn config (#1427).
 *
 * The session/task spawn handlers used to assemble their config — runtime,
 * model, max turns, working directory, worktrees, MCP servers, tool policy —
 * by ad-hoc fallback chains repeated at every call site (`provider ||
 * persona.runtime`, `cfg?.maxTurns || persona.maxTurns`, etc.). This module
 * centralizes the cascade so precedence is declared once, tested once, and
 * extending it (e.g. when the Agent entity becomes config-bearing in the
 * #1418 follow-up) is a one-line change at the call sites.
 *
 * Pure (no I/O). Persona ID selection still runs through {@link
 * resolvePersona} from `@grackle-ai/prompt` *before* this resolver, because
 * the persona ID determines which persona record to load; this resolver
 * accepts the already-loaded layer contributions.
 *
 * Precedence (highest first): `spawnOverride > task > agent > workspace >
 * persona > host`. For scalars (runtime, model, maxTurns, workingDirectory,
 * useWorktrees), the first layer with a defined contribution wins. For
 * lists (mcpServers, toolConfig), all contributing layers are merged with
 * documented semantics (see {@link mergeMcpServers}, {@link mergeToolConfig}).
 *
 * @module
 */

/** Structural view of an MCP server entry — matches `grackle.McpServerConfig`. */
export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
  tools: string[];
}

/** Structural view of a tool policy — matches `grackle.ToolConfig`. */
export interface ToolConfigSpec {
  allowedTools: string[];
  disallowedTools: string[];
}

/**
 * Per-layer contribution to the spawn config. `undefined` on any field means
 * "this layer makes no contribution; defer to the next layer." Empty arrays
 * on list fields likewise mean "no contribution" (matches the proto sentinel
 * for `mcp_servers`/`tool_config` repeated fields).
 */
export interface SpawnConfigLayer {
  runtime?: string;
  model?: string;
  maxTurns?: number;
  workingDirectory?: string;
  useWorktrees?: boolean;
  toolConfig?: ToolConfigSpec;
  mcpServers?: McpServerSpec[];
}

/** Final resolved spec passed into the runtime SDK's `createSession`. */
export interface ResolvedSpawnSpec {
  runtime: string;
  model: string;
  maxTurns: number;
  workingDirectory: string;
  /**
   * `undefined` when no layer expressed an opinion — call sites that need a
   * hard default (e.g. task path: `false` when no workspace exists) apply it
   * at the boundary. The session path passes `undefined` through to the
   * adapter so its own host default applies.
   */
  useWorktrees: boolean | undefined;
  toolConfig: ToolConfigSpec;
  mcpServers: McpServerSpec[];
}

/** Inputs to {@link resolveSpawnSpec}. Layers are listed lowest → highest precedence. */
export interface ResolveSpawnSpecInput {
  /** Process-level defaults (env vars, hardcoded fallbacks). Always present. */
  host: SpawnConfigLayer;
  /** Already-resolved persona (via {@link resolvePersona}). Always present. */
  persona: SpawnConfigLayer;
  /** Workspace defaults — absent for spawns with no workspace context. */
  workspace?: SpawnConfigLayer;
  /**
   * Standing-Agent defaults — present when an Agent owns the spawn (#1418).
   * Today contributes nothing (the minimal Agent holds only a persona
   * reference); reserved so the #1418 follow-up that makes Agents
   * config-bearing is a one-line adapter change.
   */
  agent?: SpawnConfigLayer;
  /** Task-level overrides — absent for direct spawns without a task. */
  task?: SpawnConfigLayer;
  /** Per-spawn explicit overrides from the gRPC request. */
  spawnOverride?: SpawnConfigLayer;
}

/**
 * Resolve a spawn spec from the layered contributions. Precedence (highest
 * first): `spawnOverride > task > agent > workspace > persona > host`.
 */
export function resolveSpawnSpec(input: ResolveSpawnSpecInput): ResolvedSpawnSpec {
  // High → low precedence. The first layer with a defined scalar wins.
  const layers: SpawnConfigLayer[] = [
    input.spawnOverride ?? {},
    input.task ?? {},
    input.agent ?? {},
    input.workspace ?? {},
    input.persona,
    input.host,
  ];

  return {
    runtime: pickString(layers, "runtime") ?? "",
    model: pickString(layers, "model") ?? "",
    maxTurns: pickNumber(layers, "maxTurns") ?? 0,
    workingDirectory: pickString(layers, "workingDirectory") ?? "",
    useWorktrees: pickBoolean(layers, "useWorktrees"),
    // For lists, merge low → high so higher-precedence layers can override.
    toolConfig: mergeToolConfig([...layers].reverse()),
    mcpServers: mergeMcpServers([...layers].reverse()),
  };
}

function pickString(
  layers: SpawnConfigLayer[],
  key: "runtime" | "model" | "workingDirectory",
): string | undefined {
  for (const layer of layers) {
    const v = layer[key];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

function pickNumber(layers: SpawnConfigLayer[], key: "maxTurns"): number | undefined {
  for (const layer of layers) {
    const v = layer[key];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

function pickBoolean(layers: SpawnConfigLayer[], key: "useWorktrees"): boolean | undefined {
  for (const layer of layers) {
    const v = layer[key];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/**
 * Merge `ToolConfigSpec` across layers (low → high precedence).
 *
 * - `disallowedTools`: union of every contributing layer's list.
 * - `allowedTools`: union of every contributing layer's list, then
 *   **filtered** so any tool in `disallowedTools` is removed. Deny-wins is
 *   enforced *here* so consumers can use `allowedTools` directly without
 *   re-implementing the rule (and without risking accidental allows).
 *
 * Rationale: workspace/task/agent overrides should *tighten* persona's
 * permissions, not widen them. A `disallowedTools` entry in any layer
 * forbids the tool regardless of `allowedTools` at higher layers.
 *
 * @param layers - Layers in low → high precedence order (e.g.
 *   `[host, persona, workspace, agent, task, spawnOverride]`).
 */
export function mergeToolConfig(layers: SpawnConfigLayer[]): ToolConfigSpec {
  const allowed = new Set<string>();
  const disallowed = new Set<string>();
  for (const layer of layers) {
    const tc = layer.toolConfig;
    if (!tc) {
      continue;
    }
    for (const t of tc.allowedTools) {
      allowed.add(t);
    }
    for (const t of tc.disallowedTools) {
      disallowed.add(t);
    }
  }
  for (const t of disallowed) {
    allowed.delete(t);
  }
  return {
    allowedTools: [...allowed],
    disallowedTools: [...disallowed],
  };
}

/**
 * Merge `McpServerSpec[]` across layers (low → high precedence). Servers
 * key by `name`: a higher-precedence layer's same-name entry **replaces**
 * the lower-precedence one wholesale; new names append.
 *
 * Rationale: a workspace's `"github"` MCP server (e.g. different auth token)
 * should override the persona's, not silently merge `args`/`tools`.
 *
 * @param layers - Layers in low → high precedence order.
 */
export function mergeMcpServers(layers: SpawnConfigLayer[]): McpServerSpec[] {
  const byName = new Map<string, McpServerSpec>();
  for (const layer of layers) {
    const servers = layer.mcpServers;
    if (!servers || servers.length === 0) {
      continue;
    }
    for (const s of servers) {
      byName.set(s.name, s);
    }
  }
  return [...byName.values()];
}

// ─── Source adapters ──────────────────────────────────────────────────────
// Each adapter converts a source shape's proto/db sentinels (empty string,
// zero, empty array) into `undefined` so the resolver remains field-agnostic.

/** Subset of `ResolvedPersona` used to build the persona layer contribution. */
export interface PersonaConfigSource {
  runtime: string;
  model: string;
  maxTurns: number;
  /** JSON string — see `Persona.tool_config` (`{}` is the empty sentinel). */
  toolConfig: string;
  /** JSON string — see `Persona.mcp_servers` (`[]` or `""` is the empty sentinel). */
  mcpServers: string;
}

/**
 * Build a persona-layer contribution from an already-resolved persona record.
 * Caller resolves the persona via `resolvePersona()` from `@grackle-ai/prompt`.
 *
 * `maxTurns` is passed through verbatim: on a persona, `0` documents
 * *unlimited* (per `PersonaResolveInput` in `@grackle-ai/prompt`), not
 * "unset" — so the persona always contributes a concrete value and a
 * future lower-precedence default cannot accidentally override an explicit
 * "unlimited". The `SpawnRequest`-side adapter normalizes `0 → undefined`
 * because for the `SessionConfig.max_turns` proto field, `0` is the
 * unset sentinel that means "use the persona default."
 */
export function personaToLayer(p: PersonaConfigSource): SpawnConfigLayer {
  return {
    runtime: p.runtime || undefined,
    model: p.model || undefined,
    maxTurns: p.maxTurns,
    toolConfig: parseToolConfigJson(p.toolConfig),
    mcpServers: parseMcpServersJson(p.mcpServers),
  };
}

/** Subset of `WorkspaceRow` used to build the workspace layer contribution. */
export interface WorkspaceConfigSource {
  useWorktrees: boolean;
  workingDirectory: string;
}

/** Build a workspace-layer contribution from a workspace row. */
export function workspaceToLayer(w: WorkspaceConfigSource): SpawnConfigLayer {
  return {
    workingDirectory: w.workingDirectory || undefined,
    // `useWorktrees` is a real boolean on the workspace (default true on
    // insert) — both `true` and `false` are intentional contributions.
    useWorktrees: w.useWorktrees,
  };
}

/** Subset of `TaskRow` reserved for future per-task config (#1418 follow-up). */
export interface TaskConfigSource {
  // Today the task contributes nothing to the spawn cascade. Reserved as
  // the documented seam for per-task overrides (e.g. per-task maxTurns).
}

/** Build a task-layer contribution. Currently empty by design. */
export function taskToLayer(_t: TaskConfigSource): SpawnConfigLayer {
  return {};
}

/**
 * Subset of `AgentRow` reserved for the #1418 follow-up that makes Agents
 * config-bearing. Today the minimal Agent holds only `primaryPersonaId`
 * (already consumed via the persona-ID cascade in `resolvePersona`), so this
 * layer contributes nothing.
 */
export interface AgentConfigSource {
  // Reserved for the #1418 follow-up.
}

/** Build an agent-layer contribution. Currently empty by design. */
export function agentToLayer(_a: AgentConfigSource): SpawnConfigLayer {
  return {};
}

/**
 * Spawn-time overrides from a `grackle.SpawnRequest`. Reads only the fields
 * the resolver cares about so the adapter can be exercised in tests without
 * constructing a full proto message.
 */
export interface SpawnRequestSource {
  /** `SpawnRequest.provider` — `""` = unset. */
  provider?: string;
  /** `SpawnRequest.model.id` — `""` = unset. */
  modelId?: string;
  /** `SpawnRequest.config.max_turns` — `0` = unset. */
  configMaxTurns?: number;
  /** `SpawnRequest.config.working_directory` — `""` = unset (trimmed). */
  configWorkingDirectory?: string;
  /** `SpawnRequest.config.use_worktrees` — proto3 optional, `undefined` = unset. */
  configUseWorktrees?: boolean;
}

/** Build a spawn-override layer from the relevant `SpawnRequest` fields. */
export function spawnRequestToLayer(src: SpawnRequestSource): SpawnConfigLayer {
  const wd = (src.configWorkingDirectory ?? "").trim();
  return {
    runtime: src.provider || undefined,
    model: src.modelId || undefined,
    maxTurns: src.configMaxTurns || undefined,
    workingDirectory: wd || undefined,
    useWorktrees: src.configUseWorktrees,
  };
}

/**
 * Host-level defaults — env-var fallbacks for working directory, with the
 * legacy hardcoded `/workspace` default applied when neither env var is set.
 * `useWorktrees` is intentionally omitted; call sites that require a hard
 * default apply it at the boundary (the resolver leaves it `undefined` so
 * the adapter's own default can apply).
 */
export function hostDefaults(): SpawnConfigLayer {
  return {
    workingDirectory:
      process.env.GRACKLE_WORKING_DIRECTORY || process.env.GRACKLE_WORKTREE_BASE || "/workspace",
  };
}

// ─── JSON parsers for persona-stored config ──────────────────────────────

function parseToolConfigJson(json: string): ToolConfigSpec | undefined {
  if (!json) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as { allowedTools?: unknown; disallowedTools?: unknown };
  const allowed = stringArray(obj.allowedTools);
  const disallowed = stringArray(obj.disallowedTools);
  if (allowed.length === 0 && disallowed.length === 0) {
    return undefined;
  }
  return { allowedTools: allowed, disallowedTools: disallowed };
}

function parseMcpServersJson(json: string): McpServerSpec[] | undefined {
  if (!json) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined;
  }
  const servers: McpServerSpec[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as {
      name?: unknown;
      command?: unknown;
      args?: unknown;
      tools?: unknown;
    };
    if (typeof e.name !== "string" || !e.name) {
      continue;
    }
    servers.push({
      name: e.name,
      command: typeof e.command === "string" ? e.command : "",
      args: stringArray(e.args),
      tools: stringArray(e.tools),
    });
  }
  return servers.length > 0 ? servers : undefined;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.filter((x): x is string => typeof x === "string");
}
