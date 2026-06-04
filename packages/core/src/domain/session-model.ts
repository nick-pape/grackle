/**
 * Domain model for a Session, decoupled from the database row shape.
 *
 * Nullable DB columns are mapped to `string | undefined` (Rush lint forbids
 * `null` in new types). The mapper converts `null → undefined`.
 *
 * @module
 */
import type { SessionRow } from "@grackle-ai/database";

/** Domain view of a session record. */
export interface SessionModel {
  id: string;
  environmentId: string;
  runtime: string;
  runtimeSessionId: string | undefined;
  prompt: string;
  model: string;
  status: string;
  logPath: string | undefined;
  turns: number;
  startedAt: string;
  suspendedAt: string | undefined;
  endedAt: string | undefined;
  endReason: string | undefined;
  error: string | undefined;
  taskId: string;
  personaId: string;
  parentSessionId: string;
  pipeMode: string;
  inputTokens: number;
  outputTokens: number;
  costMillicents: number;
  sigtermSentAt: string | undefined;
}

/** Convert a database SessionRow to a SessionModel. Converts `null → undefined`. */
export function toSessionModel(row: SessionRow): SessionModel {
  return {
    ...row,
    runtimeSessionId: row.runtimeSessionId ?? undefined,
    logPath: row.logPath ?? undefined,
    suspendedAt: row.suspendedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
    endReason: row.endReason ?? undefined,
    error: row.error ?? undefined,
    sigtermSentAt: row.sigtermSentAt ?? undefined,
  };
}
