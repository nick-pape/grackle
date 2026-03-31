/**
 * Proto converter for schedule database rows.
 */

import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import type { scheduleStore } from "@grackle-ai/database";

/** Convert a schedule database row to its proto representation. */
export function scheduleRowToProto(row: scheduleStore.ScheduleRow): grackle.Schedule {
  return create(grackle.ScheduleSchema, {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduleExpression: row.scheduleExpression,
    personaId: row.personaId,
    environmentId: row.environmentId,
    workspaceId: row.workspaceId,
    parentTaskId: row.parentTaskId,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt ?? "",
    nextRunAt: row.nextRunAt ?? "",
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
