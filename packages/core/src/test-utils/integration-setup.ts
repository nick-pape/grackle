/**
 * Shared setup for gRPC handler integration tests.
 *
 * Provides an in-memory SQLite database (real stores, no database mocks)
 * and a helper to extract handler methods via {@link createDefaultCollector}.
 */
import { openDatabase, initDatabase, sqlite, seedDatabase } from "@grackle-ai/database";
import { grackle } from "@grackle-ai/common";
import { createDefaultCollector } from "../grpc-service.js";

/**
 * Initialize an in-memory SQLite database with all tables and seed data.
 * Call once in `beforeAll`.
 */
export function initTestDatabase(): void {
  openDatabase(":memory:");
  initDatabase();
  seedDatabase(sqlite!);
}

/**
 * Extract the service handler map for the Grackle service.
 * Uses the {@link createDefaultCollector} to get all built-in handlers.
 */
export function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  return createDefaultCollector().getHandlers(grackle.Grackle) as Record<string, (...args: unknown[]) => unknown>;
}
