import type { Client } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { MAX_TASK_DEPTH, ROOT_TASK_ID } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import type { GrackleClients, ToolDefinition } from "./tool-registry.js";

/**
 * Assert that the caller (identified by scoped auth) is an ancestor of the target task.
 *
 * - No-op for non-scoped auth (api-key, oauth, undefined).
 * - Rejects if targetTaskId equals the caller's own taskId.
 * - Walks up from target via getTask().parentTaskId until it finds the caller's taskId (pass)
 *   or reaches a root task (reject with PERMISSION_DENIED).
 */
export async function assertCallerIsAncestor(
  client: Client<typeof grackle.GrackleOrchestration>,
  authContext: AuthContext | undefined,
  targetTaskId: string,
): Promise<void> {
  if (authContext?.type !== "scoped") {
    return;
  }

  const callerTaskId = authContext.taskId;

  if (targetTaskId === callerTaskId) {
    throw new ConnectError("Cannot operate on your own task", Code.PermissionDenied);
  }

  let currentId = targetTaskId;
  for (let i = 0; i < MAX_TASK_DEPTH; i++) {
    const task = await client.getTask({ id: currentId });
    const parentId = task.parentTaskId;

    if (parentId === callerTaskId) {
      return; // caller is an ancestor — allowed
    }

    if (!parentId) {
      break; // reached root without finding caller
    }

    currentId = parentId;
  }

  throw new ConnectError(
    "Target task is not a descendant of the caller's task",
    Code.PermissionDenied,
  );
}

/**
 * Central, fail-closed authorization for a resolved MCP tool call
 * (GHSA-f9ff-5x35-7gfw). Enforces a tool's declarative {@link ToolDefinition.scope}
 * for scoped (agent) callers so that destructive task/session tools cannot be
 * invoked against tasks/sessions the caller does not own. This is the single
 * choke point that keeps new task/session-targeting tools from silently failing
 * open the way the per-tool inline checks used to.
 *
 * - No-op for non-scoped auth (api-key, oauth) — they have full access.
 * - No-op for the root/system task (the central orchestrator), mirroring
 *   `hasFullAccess` in tool-scoping.ts.
 * - No-op for tools without a `scope` descriptor (a tool opts in by declaring
 *   one — a task/session-targeting tool that needs protection MUST set it).
 * - For a `taskIdArg` tool: the caller must be an ancestor of the target task.
 * - For a `sessionIdArg` tool: the session is resolved to its task (a taskless
 *   session is rejected for scoped callers) and the caller must be its ancestor.
 *
 * A descriptor that is present but malformed (neither or both arg fields set)
 * **fails closed** — it throws rather than silently skipping the check — so a
 * misconfigured new tool surfaces immediately instead of becoming a bypass.
 *
 * A missing or empty target *value* is left to the tool's Zod validation, which
 * runs after this check and returns INVALID_ARGUMENT.
 *
 * @throws ConnectError with `Code.PermissionDenied` when the caller is not
 *   authorized for the target, or when the tool's `scope` descriptor is malformed.
 */
export async function enforceToolScope(
  clients: GrackleClients,
  tool: ToolDefinition,
  authContext: AuthContext | undefined,
  args: Record<string, unknown>,
): Promise<void> {
  if (authContext?.type !== "scoped") {
    return;
  }
  if (authContext.taskId === ROOT_TASK_ID) {
    return;
  }
  const scope = tool.scope;
  if (!scope) {
    return;
  }

  // Fail closed on a malformed descriptor: a `scope` must target exactly one of
  // a task or a session. Both-or-neither is a programming error that would
  // otherwise silently skip the authorization branch (an accidental bypass).
  if (Boolean(scope.taskIdArg) === Boolean(scope.sessionIdArg)) {
    throw new ConnectError(
      `Tool "${tool.name}" has a malformed scope descriptor (set exactly one of taskIdArg / sessionIdArg)`,
      Code.PermissionDenied,
    );
  }

  if (scope.taskIdArg) {
    const targetTaskId = args[scope.taskIdArg];
    if (typeof targetTaskId === "string" && targetTaskId) {
      await assertCallerIsAncestor(clients.orchestration, authContext, targetTaskId);
    }
    return;
  }

  // scope.sessionIdArg is set (the exactly-one invariant is enforced above).
  if (scope.sessionIdArg) {
    const sessionId = args[scope.sessionIdArg];
    if (typeof sessionId === "string" && sessionId) {
      const session = await clients.core.getSession({ id: sessionId });
      if (!session.taskId) {
        throw new ConnectError(
          "Cannot operate on a taskless session via scoped auth",
          Code.PermissionDenied,
        );
      }
      await assertCallerIsAncestor(clients.orchestration, authContext, session.taskId);
    }
  }
}

/**
 * Workspace-membership gate for ID-resolving *read* tools (GHSA-f9ff-5x35-7gfw
 * F7). A scoped, non-root caller may read a task/schedule only when the record's
 * workspace matches the caller's own. This runs even when the caller has *no*
 * workspace — such a caller is a member of *no* workspace and may read only
 * workspaceless records. The previous inline check skipped whenever the caller's
 * `workspaceId` was falsy, so a workspaceless scoped token could read any record
 * (fail-open). The `scope` descriptor (enforceToolScope) covers mutations; new
 * ID-resolving read tools must be added here.
 *
 * - No-op for non-scoped auth and for the root/system task.
 * - No-op for tools that are not membership-gated reads.
 *
 * @throws ConnectError with `Code.PermissionDenied` when the record's workspace
 *   does not match the caller's.
 */
export async function enforceReadMembership(
  clients: GrackleClients,
  toolName: string,
  authContext: AuthContext | undefined,
  args: Record<string, unknown>,
): Promise<void> {
  if (authContext?.type !== "scoped") {
    return;
  }
  if (authContext.taskId === ROOT_TASK_ID) {
    return;
  }

  let recordWorkspaceId: string | undefined;
  let gated = false;
  if (toolName === "task_show" && typeof args.taskId === "string" && args.taskId) {
    gated = true;
    const task = await clients.orchestration.getTask({ id: args.taskId });
    recordWorkspaceId = task.workspaceId || undefined;
  } else if (
    toolName === "schedule_show" &&
    typeof args.scheduleId === "string" &&
    args.scheduleId
  ) {
    gated = true;
    const schedule = await clients.scheduling.getSchedule({ id: args.scheduleId });
    recordWorkspaceId = schedule.workspaceId || undefined;
  }

  if (gated && recordWorkspaceId !== authContext.workspaceId) {
    throw new ConnectError("Record belongs to a different workspace", Code.PermissionDenied);
  }
}

/**
 * Assert that the caller is either the target task itself OR an ancestor of it.
 *
 * Used by workpad tools where an agent needs to operate on its own task (self)
 * or inspect/write a child task's workpad (ancestor).
 *
 * - No-op for non-scoped auth (api-key, oauth, undefined).
 * - Allows targetTaskId === callerTaskId (self).
 * - Otherwise walks up the parent chain like assertCallerIsAncestor.
 */
export async function assertCallerIsSelfOrAncestor(
  client: Client<typeof grackle.GrackleOrchestration>,
  authContext: AuthContext | undefined,
  targetTaskId: string,
): Promise<void> {
  if (authContext?.type !== "scoped") {
    return;
  }

  const callerTaskId = authContext.taskId;

  // Self-access is allowed
  if (targetTaskId === callerTaskId) {
    return;
  }

  // Otherwise defer to the ancestor-only check to reuse the same walk/limits
  try {
    await assertCallerIsAncestor(client, authContext, targetTaskId);
  } catch {
    throw new ConnectError(
      "Target task is not self or a descendant of the caller's task",
      Code.PermissionDenied,
    );
  }
}
