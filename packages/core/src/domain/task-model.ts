/**
 * Domain model for a Task, decoupled from the database row shape.
 *
 * Key difference from TaskRow: `dependsOn` is `string[]` (parsed from JSON).
 * Nullable DB columns are mapped to `string | undefined`.
 *
 * @module
 */
import type { TaskRow } from "@grackle-ai/database";
import { safeParseJsonArray } from "@grackle-ai/database";

/** Domain view of a task record. `dependsOn` is already parsed from JSON. */
export interface TaskModel {
  id: string;
  workspaceId: string | undefined;
  title: string;
  description: string;
  status: string;
  branch: string;
  /** Task IDs this task depends on (parsed from JSON). */
  dependsOn: string[];
  startedAt: string | undefined;
  completedAt: string | undefined;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  parentTaskId: string;
  depth: number;
  canDecompose: boolean;
  injectKnowledge: boolean;
  defaultPersonaId: string;
  workpad: string;
  scheduleId: string;
  tokenBudget: number;
  costBudgetMillicents: number;
  agentId: string | undefined;
  kind: string;
}

/** Convert a database TaskRow to a TaskModel. Parses `dependsOn` from JSON and converts `null → undefined`. */
export function toTaskModel(row: TaskRow): TaskModel {
  return {
    ...row,
    workspaceId: row.workspaceId ?? undefined,
    dependsOn: safeParseJsonArray(row.dependsOn),
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    agentId: row.agentId ?? undefined,
  };
}
