/**
 * Shared setup for gRPC handler integration tests.
 *
 * Provides an in-memory SQLite database (real stores, no database mocks)
 * and a helper to extract handler methods from {@link registerGrackleRoutes}.
 */
import { openDatabase, initDatabase, sqlite } from "@grackle-ai/database";
import { seedDatabase } from "@grackle-ai/database";
import { registerGrackleRoutes } from "../grpc-service.js";
import type { ConnectRouter } from "@connectrpc/connect";

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
 * Extract the service handler map from `registerGrackleRoutes` by
 * calling it with a fake router that captures the method implementations.
 */
export function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const fakeRouter = {
    service(_def: unknown, impl: Record<string, (...args: unknown[]) => unknown>) {
      handlers = impl;
    },
  } as unknown as ConnectRouter;
  registerGrackleRoutes(fakeRouter);
  return handlers;
}
