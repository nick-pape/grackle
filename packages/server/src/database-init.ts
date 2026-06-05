import {
  openDatabase,
  checkDatabaseIntegrity,
  initDatabase,
  seedDatabase,
  sqlite,
  startWalCheckpointTimer,
  envRegistry,
} from "@grackle-ai/database";
import { getRegisteredPlugins } from "@grackle-ai/plugin-sdk";

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

  const pluginSeeds = getRegisteredPlugins()
    .filter((p) => !p.required)
    .map((p) => ({
      name: p.name,
      defaultEnabled: p.defaultEnabled,
      envOverride: p.envOverride,
    }));
  seedDatabase(sqlite!, pluginSeeds);

  startWalCheckpointTimer();
  envRegistry.resetAllStatuses();
}
