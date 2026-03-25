import type { Client } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";

/**
 * Assert that the caller (identified by scoped auth) is an ancestor of the target task.
 *
 * - No-op for non-scoped auth (api-key, oauth, undefined).
 * - Rejects if targetTaskId equals the caller's own taskId.
 * - Walks up from target via getTask().parentTaskId until it finds the caller's taskId (pass)
 *   or reaches a root task (reject with PERMISSION_DENIED).
 */
export async function assertCallerIsAncestor(
  client: Client<typeof grackle.Grackle>,
  authContext: AuthContext | undefined,
  targetTaskId: string,
): Promise<void> {
  if (authContext?.type !== "scoped") {
    return;
  }

  const callerTaskId = authContext.taskId;

  if (targetTaskId === callerTaskId) {
    throw new ConnectError(
      "Cannot operate on your own task",
      Code.PermissionDenied,
    );
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
  client: Client<typeof grackle.Grackle>,
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

  // Otherwise check ancestry (reuse the same walk)
  let currentId = targetTaskId;
  for (let i = 0; i < MAX_TASK_DEPTH; i++) {
    const task = await client.getTask({ id: currentId });
    const parentId = task.parentTaskId;

    if (parentId === callerTaskId) {
      return;
    }

    if (!parentId) {
      break;
    }

    currentId = parentId;
  }

  throw new ConnectError(
    "Target task is not self or a descendant of the caller's task",
    Code.PermissionDenied,
  );
}
