import type { Client } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import type { AuthContext } from "./auth-context.js";

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
