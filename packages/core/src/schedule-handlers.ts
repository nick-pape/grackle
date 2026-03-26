import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { personaStore, scheduleStore } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { validateExpression, computeNextRunAt } from "./schedule-expression.js";
import { emit } from "./event-bus.js";
import { scheduleRowToProto } from "./grpc-proto-converters.js";

/** Create a new schedule. */
export async function createSchedule(req: grackle.CreateScheduleRequest): Promise<grackle.Schedule> {
  const title = req.title.trim();
  const expr = req.scheduleExpression.trim();
  const personaId = req.personaId.trim();
  if (!title) {
    throw new ConnectError("title is required", Code.InvalidArgument);
  }
  if (!expr) {
    throw new ConnectError("schedule_expression is required", Code.InvalidArgument);
  }
  if (!personaId) {
    throw new ConnectError("persona_id is required", Code.InvalidArgument);
  }
  // Validate persona exists
  const persona = personaStore.getPersona(personaId);
  if (!persona) {
    throw new ConnectError(`Persona not found: ${personaId}`, Code.NotFound);
  }
  // Validate expression
  try {
    validateExpression(expr);
  } catch (err) {
    throw new ConnectError(
      err instanceof Error ? err.message : "Invalid schedule expression",
      Code.InvalidArgument,
    );
  }
  const id = uuid();
  const nextRunAt = computeNextRunAt(expr);
  scheduleStore.createSchedule(
    id,
    title,
    req.description,
    expr,
    personaId,
    req.environmentId,
    req.workspaceId,
    req.parentTaskId,
    nextRunAt,
  );
  emit("schedule.created", { scheduleId: id });
  const row = scheduleStore.getSchedule(id);
  return scheduleRowToProto(row!);
}

/** List all schedules, optionally filtered by workspace. */
export async function listSchedules(req: grackle.ListSchedulesRequest): Promise<grackle.ScheduleList> {
  const rows = scheduleStore.listSchedules(req.workspaceId || undefined);
  return create(grackle.ScheduleListSchema, {
    schedules: rows.map(scheduleRowToProto),
  });
}

/** Get a schedule by ID. */
export async function getSchedule(req: grackle.ScheduleId): Promise<grackle.Schedule> {
  const row = scheduleStore.getSchedule(req.id);
  if (!row) {
    throw new ConnectError(`Schedule not found: ${req.id}`, Code.NotFound);
  }
  return scheduleRowToProto(row);
}

/** Update an existing schedule. */
export async function updateSchedule(req: grackle.UpdateScheduleRequest): Promise<grackle.Schedule> {
  const existing = scheduleStore.getSchedule(req.id);
  if (!existing) {
    throw new ConnectError(`Schedule not found: ${req.id}`, Code.NotFound);
  }

  const update: scheduleStore.ScheduleUpdate = {};
  if (req.title !== undefined && req.title.trim() !== "") {
    update.title = req.title.trim();
  }
  if (req.description !== undefined) {
    update.description = req.description;
  }
  if (req.personaId !== undefined && req.personaId.trim() !== "") {
    const trimmedPersonaId = req.personaId.trim();
    const persona = personaStore.getPersona(trimmedPersonaId);
    if (!persona) {
      throw new ConnectError(`Persona not found: ${trimmedPersonaId}`, Code.NotFound);
    }
    update.personaId = trimmedPersonaId;
  }
  if (req.environmentId !== undefined) {
    update.environmentId = req.environmentId;
  }

  // Handle schedule expression change
  let expressionChanged = false;
  if (req.scheduleExpression !== undefined && req.scheduleExpression !== "") {
    const expr = req.scheduleExpression.trim();
    try {
      validateExpression(expr);
    } catch (err) {
      throw new ConnectError(
        err instanceof Error ? err.message : "Invalid schedule expression",
        Code.InvalidArgument,
      );
    }
    update.scheduleExpression = expr;
    expressionChanged = true;
  }

  // Handle enable/disable
  if (req.enabled !== undefined) {
    update.enabled = req.enabled;
    if (req.enabled) {
      const expr = update.scheduleExpression ?? existing.scheduleExpression;
      update.nextRunAt = computeNextRunAt(expr);
    } else {
      update.nextRunAt = null;
    }
  } else if (expressionChanged) {
    // Recompute nextRunAt when expression changes (if currently enabled)
    if (existing.enabled) {
      update.nextRunAt = computeNextRunAt(update.scheduleExpression!);
    }
  }

  scheduleStore.updateSchedule(req.id, update);
  emit("schedule.updated", { scheduleId: req.id });
  const row = scheduleStore.getSchedule(req.id);
  return scheduleRowToProto(row!);
}

/** Delete a schedule by ID. */
export async function deleteSchedule(req: grackle.ScheduleId): Promise<grackle.Empty> {
  scheduleStore.deleteSchedule(req.id);
  emit("schedule.deleted", { scheduleId: req.id });
  return create(grackle.EmptySchema, {});
}
