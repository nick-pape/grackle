/**
 * Domain model for an Escalation, decoupled from the database row shape.
 *
 * Nullable DB columns are mapped to `string | undefined`.
 *
 * @module
 */
import type { EscalationRow } from "@grackle-ai/database";

/** Domain view of an escalation record. */
export interface EscalationModel {
  id: string;
  workspaceId: string;
  taskId: string;
  title: string;
  message: string;
  source: string;
  urgency: string;
  status: string;
  createdAt: string;
  deliveredAt: string | undefined;
  acknowledgedAt: string | undefined;
  taskUrl: string;
}

/** Convert a database EscalationRow to an EscalationModel. Converts `null → undefined`. */
export function toEscalationModel(row: EscalationRow): EscalationModel {
  return {
    ...row,
    deliveredAt: row.deliveredAt ?? undefined,
    acknowledgedAt: row.acknowledgedAt ?? undefined,
  };
}
