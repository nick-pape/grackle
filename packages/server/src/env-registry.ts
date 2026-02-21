import db from "./db.js";
import type { EnvironmentStatus } from "@grackle/common";

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
}

const stmts = {
  list: db.prepare("SELECT * FROM environments"),
  get: db.prepare("SELECT * FROM environments WHERE id = ?"),
  insert: db.prepare(`
    INSERT INTO environments (id, display_name, adapter_type, adapter_config, default_runtime)
    VALUES (?, ?, ?, ?, ?)
  `),
  remove: db.prepare("DELETE FROM environments WHERE id = ?"),
  updateStatus: db.prepare("UPDATE environments SET status = ?, last_seen = datetime('now') WHERE id = ?"),
  markBootstrapped: db.prepare("UPDATE environments SET bootstrapped = 1 WHERE id = ?"),
  setEnvInfo: db.prepare("UPDATE environments SET env_info = ? WHERE id = ?"),
};

export function listEnvironments(): EnvironmentRow[] {
  return stmts.list.all() as EnvironmentRow[];
}

export function getEnvironment(id: string): EnvironmentRow | undefined {
  return stmts.get.get(id) as EnvironmentRow | undefined;
}

export function addEnvironment(
  id: string,
  displayName: string,
  adapterType: string,
  adapterConfig: string,
  defaultRuntime: string
): void {
  stmts.insert.run(id, displayName, adapterType, adapterConfig, defaultRuntime);
}

export function removeEnvironment(id: string): void {
  stmts.remove.run(id);
}

export function updateEnvironmentStatus(id: string, status: EnvironmentStatus): void {
  stmts.updateStatus.run(status, id);
}

export function markBootstrapped(id: string): void {
  stmts.markBootstrapped.run(id);
}

export function setEnvInfo(id: string, info: string): void {
  stmts.setEnvInfo.run(info, id);
}
