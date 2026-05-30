/**
 * Shared delegation (subagent) detection.
 *
 * A "delegation" is a tool call where one agent spawns or polls another agent
 * (Claude Code `Agent`/`Task`, Copilot `task`/`read_agent`). Both the server
 * (which materializes a linked child session — #1075) and the web
 * `AgentToolCard` (which renders the call) need to recognize delegations and
 * extract the same normalized fields, so the parser lives here as the single
 * source of truth rather than being duplicated per consumer.
 *
 * Detection is **arg-shape first, tool-name second**: tool names drift across
 * SDK versions, so the presence of a `prompt` plus a delegation-id field
 * (`subagent_type`/`agent_type`/`name`/`agent_id`) is what identifies a
 * delegation; the tool name is only a hint.
 *
 * @module
 */

/** Normalized info extracted from agent/subagent tool args across runtimes. */
export interface DelegationInfo {
  /** Agent type: "Explore", "Plan", "general-purpose", "worker", etc. */
  agentType?: string;
  /** Short description of the subagent task. */
  description?: string;
  /** Full prompt sent to the subagent. */
  prompt?: string;
  /** Whether the subagent runs in the background. */
  isBackground?: boolean;
  /** Model override (e.g. "sonnet", "opus"). */
  model?: string;
  /** Copilot: human-readable agent name (e.g. "find-tests"). */
  agentName?: string;
  /** Copilot read_agent: the agent_id being polled. */
  agentId?: string;
  /** Whether this is a resume of a prior subagent. */
  isResume?: boolean;
  /** Whether this is a read_agent poll (a correlation, not a fresh spawn). */
  isPoll?: boolean;
}

/**
 * Parse agent/subagent tool args from all supported runtimes into a normalized
 * shape. Returns an empty object for non-object args.
 *
 * Handles:
 * - Claude Code `Agent` / `Task`: `{ subagent_type, description, prompt, run_in_background, model, resume }`
 * - Copilot `task`: `{ agent_type, description, prompt, mode, name }`
 * - Copilot `read_agent`: `{ agent_id }`
 *
 * @param tool - Tool name as reported by the runtime.
 * @param args - Parsed tool args object.
 * @returns Normalized delegation info (empty object if args is not an object).
 */
export function parseDelegationArgs(tool: string, args: unknown): DelegationInfo {
  if (args === null || args === undefined || typeof args !== "object") {
    return {};
  }
  const a = args as Record<string, unknown>;
  const toolLower = tool.toLowerCase();

  // Copilot read_agent — polling a background agent
  if (toolLower === "read_agent") {
    return {
      agentId: typeof a.agent_id === "string" ? a.agent_id : undefined,
      isPoll: true,
    };
  }

  // Copilot task — identified by `agent_type`, `name`, and/or `agent_id`. Capture
  // `agent_id` when present so a spawn and its later read_agent polls derive the
  // same child id (delegationIdentityKey prefers agentId).
  if (
    typeof a.agent_type === "string" ||
    typeof a.name === "string" ||
    typeof a.agent_id === "string"
  ) {
    return {
      agentType: typeof a.agent_type === "string" ? a.agent_type : undefined,
      description: typeof a.description === "string" ? a.description : undefined,
      prompt: typeof a.prompt === "string" ? a.prompt : undefined,
      isBackground: a.mode === "background",
      agentName: typeof a.name === "string" ? a.name : undefined,
      agentId: typeof a.agent_id === "string" ? a.agent_id : undefined,
    };
  }

  // Claude Code Agent / Task — has `subagent_type` field
  return {
    agentType: typeof a.subagent_type === "string" ? a.subagent_type : undefined,
    description: typeof a.description === "string" ? a.description : undefined,
    prompt: typeof a.prompt === "string" ? a.prompt : undefined,
    isBackground: a.run_in_background === true,
    model: typeof a.model === "string" ? a.model : undefined,
    isResume: typeof a.resume === "string" && a.resume.length > 0,
  };
}

/**
 * Decide whether a tool call is a delegation (spawning or polling a subagent).
 *
 * Arg-shape predicate (tool name is only a secondary hint):
 * - a `read_agent` poll is always a delegation reference (`isPoll`), or
 * - a spawn must carry a `prompt` **and** a delegation-id field
 *   (`agentType` from subagent_type/agent_type, or Copilot `agentName`).
 *
 * Ordinary tools that merely have a `prompt` (e.g. a search tool) but no
 * delegation-id field are rejected, as are empty-prompt calls.
 *
 * @param tool - Tool name as reported by the runtime.
 * @param args - Parsed tool args object.
 * @returns Normalized {@link DelegationInfo} if this is a delegation, else `undefined`.
 */
export function detectDelegation(tool: string, args: unknown): DelegationInfo | undefined {
  const info = parseDelegationArgs(tool, args);
  if (info.isPoll) {
    // A poll only counts as a delegation reference if it names the agent it polls.
    return info.agentId ? info : undefined;
  }
  const hasPrompt = typeof info.prompt === "string" && info.prompt.length > 0;
  const hasDelegationId =
    (typeof info.agentType === "string" && info.agentType.length > 0) ||
    (typeof info.agentName === "string" && info.agentName.length > 0) ||
    (typeof info.agentId === "string" && info.agentId.length > 0);
  if (hasPrompt && hasDelegationId) {
    return info;
  }
  return undefined;
}

/**
 * Stable identity key for a delegated subagent, used to deduplicate repeated
 * references to the same child (e.g. Copilot `read_agent` polls that follow the
 * original `task` spawn) onto one child session.
 *
 * Preference order: explicit `agentId` (Copilot) → `agentName` (Copilot) →
 * the originating tool-call id (Claude Code, which has no agent identity in its
 * args). The caller supplies `toolCallId` as the fallback.
 *
 * @param info - Parsed delegation info.
 * @param toolCallId - The originating tool_use call id (fallback identity).
 * @returns A non-empty identity key.
 */
export function delegationIdentityKey(info: DelegationInfo, toolCallId: string): string {
  return info.agentId || info.agentName || toolCallId;
}

/** Lifecycle status reported by a Copilot `read_agent` poll result. */
export type ReadAgentStatus = "completed" | "running" | "failed" | "error";

/** Matches the structured status prefix Copilot emits on a `read_agent` result. */
const READ_AGENT_STATUS_PATTERN: RegExp =
  /^Agent\s+(completed|running|failed|error)\.\s*agent_id:/i;

/**
 * Extract the lifecycle status from a Copilot `read_agent` poll result, if it
 * carries the structured `"Agent <status>. agent_id: …"` prefix. Shared so the
 * server (deciding when to close a polled child) and the web card render the
 * same status.
 *
 * @param result - The raw `read_agent` tool result text.
 * @returns The parsed status, or `undefined` if the prefix is absent.
 */
export function readAgentResultStatus(result: string): ReadAgentStatus | undefined {
  const match = READ_AGENT_STATUS_PATTERN.exec(result);
  return match ? (match[1].toLowerCase() as ReadAgentStatus) : undefined;
}

/** Prefix for materialized subagent child session ids. */
export const SUBAGENT_SESSION_PREFIX: string = "sub_";

/**
 * Runtime marker for materialized subagent child sessions (#1075). These are
 * not real PowerLine sessions — they are virtual activity logs attached to a
 * parent session — so env- and lifecycle-scoped queries (active/latest session,
 * reanimate, recovery) must exclude them by this runtime.
 */
export const SUBAGENT_RUNTIME: string = "subagent";

/**
 * Derive the deterministic child session id for a delegation. The server uses
 * this to create/resolve the child session; the web uses the *same* function to
 * compute the navigation target — so both always agree without a wire field.
 *
 * The id is a pure function of the parent session id and the delegation's
 * identity key, so repeated references to the same subagent (e.g. `read_agent`
 * polls) map to one id. The identity key is sanitized to keep the id URL- and
 * key-safe.
 *
 * @param parentSessionId - The delegating session id.
 * @param identityKey - From {@link delegationIdentityKey}.
 * @returns A deterministic, URL-safe child session id.
 */
export function deriveChildSessionId(parentSessionId: string, identityKey: string): string {
  const safeKey = identityKey.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${SUBAGENT_SESSION_PREFIX}${parentSessionId}_${safeKey}`;
}
