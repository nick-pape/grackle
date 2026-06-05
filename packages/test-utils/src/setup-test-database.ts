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

/**
 * Tables in reverse-dependency order for FK-safe truncation.
 * Child tables (those with REFERENCES) come before their parents.
 */
const TRUNCATE_ORDER: readonly string[] = [
  "session_actions",
  "stream_messages",
  "domain_events",
  "dispatch_queue",
  "channel_grants",
  "escalations",
  "findings",
  "components",
  "sessions",
  "workspace_environment_links",
  "schedules",
  "tasks",
  "agents",
  "personas",
  "tokens",
  "workspaces",
  "environments",
  "settings",
  "plugins",
  "github_accounts",
];

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
      conn.pragma("foreign_keys = OFF");
      try {
        const trx = conn.transaction(() => {
          for (const table of TRUNCATE_ORDER) {
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
