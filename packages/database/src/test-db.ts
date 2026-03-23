/**
 * In-memory SQLite database instance for unit tests.
 * Imported by test files and used via vi.mock to replace the production db module.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/** Raw better-sqlite3 instance for DDL operations in tests. */
export const sqlite: InstanceType<typeof Database> = new Database(":memory:");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/** Drizzle ORM instance wrapping the in-memory database. */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
export default db;
