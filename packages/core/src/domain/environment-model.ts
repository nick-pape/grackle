/**
 * Domain model for an Environment, decoupled from the database row shape.
 *
 * Nullable DB columns are mapped to `string | undefined`.
 *
 * @module
 */
import type { EnvironmentRow } from "@grackle-ai/database";

/** Domain view of an environment record. */
export interface EnvironmentModel {
  id: string;
  displayName: string;
  adapterType: string;
  adapterConfig: string;
  defaultRuntime: string;
  bootstrapped: boolean;
  status: string;
  lastSeen: string | undefined;
  envInfo: string | undefined;
  createdAt: string;
  powerlineToken: string;
  maxConcurrentSessions: number;
  githubAccountId: string;
}

/** Convert a database EnvironmentRow to an EnvironmentModel. Converts `null → undefined`. */
export function toEnvironmentModel(row: EnvironmentRow): EnvironmentModel {
  return {
    ...row,
    lastSeen: row.lastSeen ?? undefined,
    envInfo: row.envInfo ?? undefined,
  };
}
