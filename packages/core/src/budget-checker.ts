import { taskStore, workspaceStore, sessionStore } from "@grackle-ai/database";

/** Result from a budget check. undefined means no budget exceeded. */
export interface BudgetExceeded {
  /** Which budget scope was exceeded. */
  scope: "task" | "workspace";
  /** Which resource type triggered the budget limit. */
  reason: "token" | "cost";
  /** Human-readable message for the SIGTERM signal. */
  message: string;
}

/** Convert a USD floating-point cost to integer millicents (1 millicent = $0.00001). */
export function costUsdToMillicents(costUsd: number): number {
  return Math.floor(costUsd * 100_000);
}

/**
 * Check whether any budget is exceeded for the given task/workspace.
 * Returns undefined if within budget, or a BudgetExceeded descriptor.
 *
 * Checks task budget first (most specific), then workspace budget.
 */
export function checkBudget(taskId: string, workspaceId?: string): BudgetExceeded | undefined {
  const task = taskStore.getTask(taskId);
  if (!task) {
    return undefined;
  }

  // ── Task-level budget check ──
  // Skip aggregation when no task-level budgets are configured (common case)
  if (task.tokenBudget <= 0 && task.costBudgetMillicents <= 0 && !workspaceId) {
    return undefined;
  }

  const needsTaskUsage = task.tokenBudget > 0 || task.costBudgetMillicents > 0;
  const taskUsage = needsTaskUsage
    ? sessionStore.aggregateUsage({ taskId })
    : { inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 };
  const totalTokens = taskUsage.inputTokens + taskUsage.outputTokens;

  if (task.tokenBudget > 0 && totalTokens >= task.tokenBudget) {
    return {
      scope: "task",
      reason: "token",
      message: `Task used ${totalTokens} tokens, budget is ${task.tokenBudget}`,
    };
  }

  if (task.costBudgetMillicents > 0) {
    const usedMillicents = costUsdToMillicents(taskUsage.costUsd);
    if (usedMillicents >= task.costBudgetMillicents) {
      return {
        scope: "task",
        reason: "cost",
        message: `Task cost ${usedMillicents} millicents, budget is ${task.costBudgetMillicents}`,
      };
    }
  }

  // ── Workspace-level budget check ──
  if (!workspaceId) {
    return undefined;
  }

  const workspace = workspaceStore.getWorkspace(workspaceId);
  if (!workspace) {
    return undefined;
  }

  if (workspace.tokenBudget === 0 && workspace.costBudgetMillicents === 0) {
    return undefined;
  }

  // Aggregate usage across all tasks in the workspace
  const allTasks = taskStore.listTasks(workspaceId);
  const taskIds = allTasks.map((t) => t.id);
  const wsUsage = taskIds.length > 0
    ? sessionStore.aggregateUsage({ taskIds })
    : { inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 };
  const wsTotalTokens = wsUsage.inputTokens + wsUsage.outputTokens;

  if (workspace.tokenBudget > 0 && wsTotalTokens >= workspace.tokenBudget) {
    return {
      scope: "workspace",
      reason: "token",
      message: `Workspace used ${wsTotalTokens} tokens, budget is ${workspace.tokenBudget}`,
    };
  }

  if (workspace.costBudgetMillicents > 0) {
    const wsUsedMillicents = costUsdToMillicents(wsUsage.costUsd);
    if (wsUsedMillicents >= workspace.costBudgetMillicents) {
      return {
        scope: "workspace",
        reason: "cost",
        message: `Workspace cost ${wsUsedMillicents} millicents, budget is ${workspace.costBudgetMillicents}`,
      };
    }
  }

  return undefined;
}
