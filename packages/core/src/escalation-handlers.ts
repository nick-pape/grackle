import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { escalationStore } from "@grackle-ai/database";
import { ulid } from "ulid";
import { routeEscalation } from "./notification-router.js";
import { escalationRowToProto } from "./grpc-proto-converters.js";

/** Valid urgency values for escalations. */
const VALID_URGENCY: ReadonlySet<string> = new Set(["low", "normal", "high"]);

/** Create a new escalation and route it to notification channels. */
export async function createEscalation(req: grackle.CreateEscalationRequest): Promise<grackle.Escalation> {
  if (!req.message) {
    throw new ConnectError("message is required", Code.InvalidArgument);
  }
  const urgency = VALID_URGENCY.has(req.urgency) ? req.urgency : "normal";
  const id = ulid();
  const taskUrl = req.taskId ? `/tasks/${req.taskId}` : "";
  escalationStore.createEscalation(
    id,
    req.workspaceId,
    req.taskId,
    req.title || "Escalation",
    req.message,
    "explicit",
    urgency,
    taskUrl,
  );

  const row = escalationStore.getEscalation(id);
  if (row) {
    await routeEscalation(row);
  }

  // Re-read after routing to get updated status
  const updated = escalationStore.getEscalation(id);
  return escalationRowToProto(updated ?? row ?? {
    id,
    workspaceId: req.workspaceId,
    taskId: req.taskId,
    title: req.title || "Escalation",
    message: req.message,
    source: "explicit",
    urgency: req.urgency || "normal",
    status: "pending",
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    acknowledgedAt: null,
    taskUrl,
  });
}

/** List escalations with optional workspace and status filters. */
export async function listEscalations(req: grackle.ListEscalationsRequest): Promise<grackle.EscalationList> {
  const rows = escalationStore.listEscalations(
    req.workspaceId || undefined,
    req.status || undefined,
    req.limit > 0 ? req.limit : undefined,
  );
  return create(grackle.EscalationListSchema, {
    escalations: rows.map(escalationRowToProto),
  });
}

/** Acknowledge an escalation (mark as seen by the human). */
export async function acknowledgeEscalation(req: grackle.AcknowledgeEscalationRequest): Promise<grackle.Escalation> {
  if (!req.id) {
    throw new ConnectError("id is required", Code.InvalidArgument);
  }
  const row = escalationStore.getEscalation(req.id);
  if (!row) {
    throw new ConnectError(`escalation not found: ${req.id}`, Code.NotFound);
  }
  escalationStore.updateEscalationStatus(req.id, "acknowledged");
  const updated = escalationStore.getEscalation(req.id);
  return escalationRowToProto(updated ?? row);
}
