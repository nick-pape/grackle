/**
 * Cross-package in-memory SQLite test helper.
 *
 * Initializes an in-memory SQLite database via the real @grackle-ai/database
 * lifecycle functions. Stores imported from @grackle-ai/database operate
 * against this DB via ESM live bindings — store functions read `db` at call
 * time, not import time.
 */
import {
  openDatabase,
  closeDatabase,
  initDatabase,
  seedDatabase,
  sqlite,
} from "@grackle-ai/database";

/** Handle returned by {@link setupTestDatabase} for test lifecycle control. */
export interface TestDatabaseHandle {
  /** Close the in-memory DB and reset the singleton. Call in `afterAll`. */
  cleanup: () => void;
  /** Delete all rows from all tables (FK-safe). Call in `beforeEach` for isolation. */
  truncateAll: () => void;
  /** Re-seed default personas, root task, and settings. Call after `truncateAll()` when needed. */
  seed: () => void;
}

/**
 * Initialize an in-memory SQLite database for cross-package integration tests.
 *
 * Opens `:memory:`, runs `initDatabase()` (creates all tables + migrations),
 * and returns lifecycle handles. Real store modules from `@grackle-ai/database`
 * operate against this DB via ESM live bindings — store functions read `db`
 * at call time, not import time.
 *
 * **Important:** Do NOT mock `@grackle-ai/database` in the test file. The stores
 * must remain as real ESM live bindings for `sqlite` access and spy compatibility.
 */
export function setupTestDatabase(): TestDatabaseHandle {
  openDatabase(":memory:");
  initDatabase();

  return {
    cleanup(): void {
      closeDatabase();
    },

    truncateAll(): void {
      const conn = sqlite;
      if (!conn) {
        throw new Error("truncateAll called but database is not initialized");
      }
      const tables = (
        conn
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);

      conn.pragma("foreign_keys = OFF");
      try {
        const trx = conn.transaction(() => {
          for (const table of tables) {
            conn.exec(`DELETE FROM "${table}"`);
          }
        });
        trx();
      } finally {
        conn.pragma("foreign_keys = ON");
      }
    },

    seed(): void {
      if (!sqlite) {
        throw new Error("seed called but database is not initialized");
      }
      seedDatabase(sqlite);
    },
  };
}
