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
 * Extract a merged handler map from all built-in Grackle services.
 *
 * Combines GrackleCore and GrackleOrchestration handlers so integration
 * tests can call any handler method regardless of which service it belongs to.
 */
export function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  const collector = createDefaultCollector();
  return {
    ...collector.getHandlers(grackle.GrackleCore),
    ...collector.getHandlers(grackle.GrackleOrchestration),
  } as Record<string, (...args: unknown[]) => unknown>;
}
