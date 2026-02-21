import db from "./db.js";
import { randomBytes } from "node:crypto";
import type { EnvironmentStatus } from "@grackle/common";

const SIDECAR_TOKEN_BYTE_LENGTH = 32;

/** Row shape for an environment record in the SQLite database. */
export interface EnvironmentRow {
  id: string;
  display_name: string;
  adapter_type: string;
  adapter_config: string;
  default_runtime: string;
  bootstrapped: number;
  status: string;
  last_seen: string | null;
  env_info: string | null;
  created_at: string;
  sidecar_token: string;
}

const stmts = {
  list: db.prepare("SELECT * FROM environments"),
  get: db.prepare("SELECT * FROM environments WHERE id = ?"),
  insert: db.prepare(`
    INSERT INTO environments (id, display_name, adapter_type, adapter_config, default_runtime, sidecar_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  remove: db.prepare("DELETE FROM environments WHERE id = ?"),
  updateStatus: db.prepare("UPDATE environments SET status = ?, last_seen = datetime('now') WHERE id = ?"),
  markBootstrapped: db.prepare("UPDATE environments SET bootstrapped = 1 WHERE id = ?"),
  setEnvInfo: db.prepare("UPDATE environments SET env_info = ? WHERE id = ?"),
};

/** Return all registered environments. */
export function listEnvironments(): EnvironmentRow[] {
  return stmts.list.all() as EnvironmentRow[];
}

/** Retrieve a single environment by ID. */
export function getEnvironment(id: string): EnvironmentRow | undefined {
  return stmts.get.get(id) as EnvironmentRow | undefined;
}

/** Insert a new environment record with a randomly-generated sidecar token. */
export function addEnvironment(
  id: string,
  displayName: string,
  adapterType: string,
  adapterConfig: string,
  defaultRuntime: string
): void {
  const sidecarToken = randomBytes(SIDECAR_TOKEN_BYTE_LENGTH).toString("hex");
  stmts.insert.run(id, displayName, adapterType, adapterConfig, defaultRuntime, sidecarToken);
}

/** Delete an environment record from the database. */
export function removeEnvironment(id: string): void {
  stmts.remove.run(id);
}

/** Update an environment's connection status and touch `last_seen`. */
export function updateEnvironmentStatus(id: string, status: EnvironmentStatus): void {
  stmts.updateStatus.run(status, id);
}

/** Mark an environment as having completed first-time bootstrap. */
export function markBootstrapped(id: string): void {
  stmts.markBootstrapped.run(id);
}

/** Store serialized environment info (e.g. OS, node version) from the sidecar. */
export function setEnvInfo(id: string, info: string): void {
  stmts.setEnvInfo.run(info, id);
}

/** Reset all environment statuses to disconnected on server startup. */
export function resetAllStatuses(): void {
  db.prepare("UPDATE environments SET status = 'disconnected'").run();
}
