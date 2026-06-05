/**
 * Database store registry — module-level singleton for dependency injection.
 *
 * The server calls {@link setDatabaseStores} once at startup (after database
 * initialization), wiring the real store implementations. Consumers call
 * {@link getDatabaseStores} to access them. Tests call {@link setDatabaseStores}
 * with mock implementations and {@link clearDatabaseStores} in teardown.
 *
 * Mirrors the `spawn-context-registry` pattern in `@grackle-ai/core`.
 */
import type { DatabaseStores } from "./store-types.js";

let stores: DatabaseStores | undefined;

/** Wire the store implementations. Called once at server startup after database init. */
export function setDatabaseStores(s: DatabaseStores): void {
  stores = s;
}

/** Retrieve the wired store implementations. Throws if not initialized. */
export function getDatabaseStores(): DatabaseStores {
  if (!stores) {
    throw new Error("Database stores not initialized. Call setDatabaseStores() at startup.");
  }
  return stores;
}

/** Clear the store registry. Test helper only. */
export function clearDatabaseStores(): void {
  stores = undefined;
}
