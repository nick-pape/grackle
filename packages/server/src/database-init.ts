import {
  openDatabase, checkDatabaseIntegrity, initDatabase,
  seedDatabase, sqlite, startWalCheckpointTimer, envRegistry,
} from "@grackle-ai/database";

/**
 * Open the database, verify integrity, run schema migrations, seed defaults,
 * start the WAL checkpoint timer, and reset all environment statuses.
 *
 * Environment statuses are reset because in-memory connections are lost on
 * server restart — every environment starts as "disconnected".
 */
export function initializeDatabase(): void {
  openDatabase();
  checkDatabaseIntegrity();
  initDatabase();
  seedDatabase(sqlite!);
  startWalCheckpointTimer();
  envRegistry.resetAllStatuses();
}
