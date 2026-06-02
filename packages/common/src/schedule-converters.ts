/**
 * Schedule database-row → proto converter.
 *
 * Lives in `@grackle-ai/common` so it's co-located with `grackle.Schedule` /
 * `grackle.ScheduleSchema` — keeping the converter and the proto type in the
 * same package avoids api-extractor's barrel-crash on cross-package type
 * resolution (the reason the previous attempt to share this from
 * `@grackle-ai/plugin-scheduling` failed; #1438 review feedback).
 *
 * Both `plugin-scheduling` and `plugin-core` need this conversion (heartbeat
 * embedding in `Agent.heartbeat`, plus the schedule CRUD handlers). Their
 * database `ScheduleRow` types satisfy {@link ScheduleRowShape} structurally
 * so they pass through without a cast.
 */
import { create } from "@bufbuild/protobuf";
import { ScheduleSchema, type Schedule } from "./gen/grackle/grackle_types_pb.js";

/**
 * Structural shape required to convert a schedule row to its proto.
 *
 * `@grackle-ai/common` can't import `ScheduleRow` from `@grackle-ai/database`
 * (lower layer can't depend on higher). This interface is the contract:
 * callers in any package whose row shape matches can pass it directly.
 */
export interface ScheduleRowShape {
  /** Unique schedule id. */
  id: string;
  /** Human-readable title (surfaces in CLI / web). */
  title: string;
  /** Free-text description; for heartbeats this is the rules prompt. */
  description: string;
  /** Interval shorthand (`"30s"`) or 5-field cron expression. */
  scheduleExpression: string;
  /** Persona to use when firing. */
  personaId: string;
  /** Workspace scope; empty = system-level. */
  workspaceId: string;
  /** Parent task for spawned children; empty = ROOT_TASK_ID. */
  parentTaskId: string;
  /** Whether the schedule is currently active. */
  enabled: boolean;
  // The underlying SQLite column is nullable (NULL when never fired / when
  // disabled). Mirroring that here keeps callers from having to translate
  // before invoking; the converter handles the proto coercion to "".
  // eslint-disable-next-line @rushstack/no-new-null
  lastRunAt: string | null;
  // eslint-disable-next-line @rushstack/no-new-null
  nextRunAt: string | null;
  /** Total times this schedule has fired. */
  runCount: number;
  /** Row-creation timestamp. */
  createdAt: string;
  /** Row-update timestamp. */
  updatedAt: string;
}

/**
 * Convert a structural schedule row to its proto representation.
 *
 * Nullable fields collapse to empty strings (proto3 string semantics).
 */
export function scheduleRowToProto(row: ScheduleRowShape): Schedule {
  return create(ScheduleSchema, {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduleExpression: row.scheduleExpression,
    personaId: row.personaId,
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
