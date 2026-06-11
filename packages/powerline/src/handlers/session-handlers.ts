/**
 * AHP session lifecycle handlers: create, dispose, list, initialize.
 * @module handlers/session-handlers
 */

import type {
  AhpResponse,
  CreateSessionParams,
  DisposeSessionParams,
  InitializeParams,
  InitializeResult,
  ListSessionsParams,
  ListSessionsResult,
  SessionStatus as SessionStatusT,
  SessionSummary,
  StateAction,
} from "@grackle-ai/ahp";
import { ActionType, JsonRpcErrorCodes, SessionStatus } from "@grackle-ai/ahp";
import type { AhpServerConnection } from "@grackle-ai/ahp-transport";
import type { AgentSession } from "@grackle-ai/runtime-sdk";
import { validateGitBranchName, worktreeDir } from "@grackle-ai/runtime-sdk";
import { resolve as resolvePath } from "node:path";

import type { ClientState } from "../ahp-types.js";
import {
  PROTOCOL_VERSION,
  SESSION_CHANNEL_PREFIX,
  sessionChannel,
  sessionIdFromChannel,
} from "../channel-codec.js";
import { getRuntime } from "../runtime-registry.js";
import {
  deleteSessionPump,
  getSession,
  listAllSessions,
  removeSession,
  startSessionPump,
} from "../session-mgr.js";

/**
 * Record the filesystem roots a newly-created session exposes for resource
 * read/list/watch.
 */
function addSessionRoots(cState: ClientState, cfg: Record<string, unknown>): void {
  const wd =
    typeof cfg.workingDirectory === "string" && cfg.workingDirectory !== ""
      ? cfg.workingDirectory
      : undefined;
  if (wd === undefined) {
    return;
  }
  const root = resolvePath(wd);
  cState.allowedRoots.add(root);
  const branch = typeof cfg.branch === "string" && cfg.branch !== "" ? cfg.branch : undefined;
  const useWorktrees = cfg.useWorktrees !== false;
  if (useWorktrees && branch !== undefined) {
    cState.allowedRoots.add(worktreeDir(root, branch));
  }
}

/** Return the canned AHP initialize handshake result. */
export function handleInitialize(_params: InitializeParams): InitializeResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverSeq: 0,
    snapshots: [],
  };
}

/** Parse `createSession` params and spawn or resume the runtime session. */
export function handleCreateSession(
  params: CreateSessionParams,
  conn: AhpServerConnection,
  cState: ClientState,
  clients: Map<string, ClientState>,
): AhpResponse | undefined {
  const sessionId = sessionIdFromChannel(params.channel);
  if (sessionId === undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: `createSession: channel must be ${SESSION_CHANNEL_PREFIX}<sessionId>`,
      },
    } satisfies AhpResponse;
  }
  const runtimeName = params.provider;
  if (runtimeName === undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: "createSession: `provider` is required",
      },
    } satisfies AhpResponse;
  }
  const runtime = getRuntime(runtimeName);
  if (runtime === undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: `Unknown runtime: ${runtimeName}`,
      },
    } satisfies AhpResponse;
  }

  const existing = getSession(sessionId);
  if (existing !== undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidRequest,
        message: `Session already active: ${sessionId}`,
      },
    } satisfies AhpResponse;
  }

  const config = params.config ?? {};
  const cfg = config as Record<string, unknown>;
  const resumeId =
    typeof cfg.resumeFromRuntimeSessionId === "string" ? cfg.resumeFromRuntimeSessionId : undefined;

  if (resumeId !== undefined && !runtime.capabilities.supportsResume) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: `Runtime '${runtime.name}' does not support session resume`,
      },
    } satisfies AhpResponse;
  }

  let session: AgentSession;
  try {
    if (resumeId !== undefined) {
      session = runtime.resume({
        sessionId,
        runtimeSessionId: resumeId,
      });
    } else {
      const prompt = typeof cfg.prompt === "string" ? cfg.prompt : "";
      const model = typeof cfg.model === "string" ? cfg.model : "";
      const maxTurns = typeof cfg.maxTurns === "number" ? cfg.maxTurns : 0;
      const branchVal =
        typeof cfg.branch === "string" && cfg.branch !== "" ? cfg.branch : undefined;
      if (branchVal !== undefined) {
        try {
          validateGitBranchName(branchVal);
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id: 0,
            error: {
              code: JsonRpcErrorCodes.InvalidParams,
              message: err instanceof Error ? err.message : "Invalid branch name",
            },
          } satisfies AhpResponse;
        }
      }
      const wdVal =
        typeof cfg.workingDirectory === "string" && cfg.workingDirectory !== ""
          ? cfg.workingDirectory
          : undefined;
      const useWorktrees = typeof cfg.useWorktrees === "boolean" ? cfg.useWorktrees : undefined;
      const systemContext =
        typeof cfg.systemContext === "string" && cfg.systemContext !== ""
          ? cfg.systemContext
          : undefined;
      const workspaceId =
        typeof cfg.workspaceId === "string" && cfg.workspaceId !== "" ? cfg.workspaceId : undefined;
      const taskId = typeof cfg.taskId === "string" ? cfg.taskId : undefined;
      const mcpServersJson = typeof cfg.mcpServersJson === "string" ? cfg.mcpServersJson : "";
      const mcpUrl = typeof cfg.mcpUrl === "string" ? cfg.mcpUrl : "";
      const mcpToken = typeof cfg.mcpToken === "string" ? cfg.mcpToken : "";
      const scriptContent =
        typeof cfg.scriptContent === "string" && cfg.scriptContent !== ""
          ? cfg.scriptContent
          : undefined;
      const pipe =
        typeof cfg.pipe === "string" && cfg.pipe !== ""
          ? (cfg.pipe as import("@grackle-ai/common").PipeMode)
          : undefined;

      session = runtime.spawn({
        sessionId,
        prompt,
        model,
        maxTurns,
        ...(branchVal !== undefined ? { branch: branchVal } : {}),
        ...(wdVal !== undefined ? { workingDirectory: wdVal } : {}),
        ...(useWorktrees !== undefined ? { useWorktrees } : {}),
        ...(systemContext !== undefined ? { systemContext } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(taskId !== undefined ? { taskId } : {}),
        mcpServers: mcpServersJson
          ? (JSON.parse(mcpServersJson) as Record<string, unknown>)
          : undefined,
        ...(mcpUrl && mcpToken ? { mcpBroker: { url: mcpUrl, token: mcpToken } } : {}),
        ...(scriptContent !== undefined ? { scriptContent } : {}),
        ...(pipe !== undefined ? { pipe } : {}),
      });
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InternalError,
        message: err instanceof Error ? err.message : String(err),
      },
    } satisfies AhpResponse;
  }

  const ownerClientId = conn.clientId;
  startSessionPump(session, (deadSessionId) => {
    const owner = clients.get(ownerClientId);
    owner?.sessionIds.delete(deadSessionId);
  });
  cState.sessionIds.add(sessionId);
  addSessionRoots(cState, cfg);

  return {
    jsonrpc: "2.0",
    id: 0,
    result: null,
  } as AhpResponse;
}

/** Kill a session and remove it from the registry. */
export function handleDisposeSession(
  params: DisposeSessionParams,
  conn: AhpServerConnection,
  clients: Map<string, ClientState>,
): AhpResponse {
  const sessionId = sessionIdFromChannel(params.channel);
  if (sessionId === undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: "disposeSession: channel must be ahp-session:/<id>",
      },
    } satisfies AhpResponse;
  }
  const session = getSession(sessionId);
  if (session !== undefined) {
    session.kill("killed");
    removeSession(sessionId);
    deleteSessionPump(sessionId);
  }
  const cState = clients.get(conn.clientId);
  if (cState !== undefined) {
    cState.sessionIds.delete(sessionId);
    const fwd = cState.forwarders.get(sessionId);
    if (fwd !== undefined) {
      fwd.serverSeq += 1;
      const killedAction: StateAction = {
        type: ActionType.SessionMetaChanged,
        _meta: { status: "killed" },
      };
      conn.session.notify("action", {
        channel: sessionChannel(sessionId),
        serverSeq: fwd.serverSeq,
        action: killedAction,
        origin: undefined,
      });
      fwd.cancelled = true;
      fwd.wake?.();
      cState.forwarders.delete(sessionId);
    }
  }
  return {
    jsonrpc: "2.0",
    id: 0,
    result: null,
  } as AhpResponse;
}

/** Map the in-memory session registry to an AHP session list. */
export function handleListSessions(_params: ListSessionsParams): ListSessionsResult {
  const items: SessionSummary[] = listAllSessions().map((s: AgentSession) => {
    const now = Date.now();
    return {
      resource: sessionChannel(s.id),
      provider: s.runtimeName,
      title: s.id,
      status: mapAgentStatusToAhp(s.status),
      createdAt: now,
      modifiedAt: now,
    };
  });
  return { items };
}

/** Map PowerLine's loose status string to AHP's bitset enum. */
function mapAgentStatusToAhp(status: string): SessionStatusT {
  switch (status) {
    case "pending":
      return SessionStatus.InProgress;
    case "running":
      return SessionStatus.InProgress;
    case "idle":
      return SessionStatus.InputNeeded;
    case "stopped":
      return SessionStatus.Idle;
    case "suspended":
      return SessionStatus.Idle;
    case "waiting_input":
      return SessionStatus.InputNeeded;
    case "completed":
      return SessionStatus.Idle;
    case "failed":
    case "killed":
    case "terminated":
      return SessionStatus.Error;
    default:
      return SessionStatus.Idle;
  }
}
