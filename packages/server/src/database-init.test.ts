import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

const callOrder: string[] = [];

vi.mock("@grackle-ai/database", () => ({
  openDatabase: vi.fn(() => { callOrder.push("openDatabase"); }),
  checkDatabaseIntegrity: vi.fn(() => { callOrder.push("checkDatabaseIntegrity"); }),
  initDatabase: vi.fn(() => { callOrder.push("initDatabase"); }),
  seedDatabase: vi.fn(() => { callOrder.push("seedDatabase"); }),
  sqlite: { __mock: true },
  startWalCheckpointTimer: vi.fn(() => { callOrder.push("startWalCheckpointTimer"); }),
  envRegistry: {
    resetAllStatuses: vi.fn(() => { callOrder.push("resetAllStatuses"); }),
  },
}));

import { initializeDatabase } from "./database-init.js";
import {
  openDatabase, checkDatabaseIntegrity, initDatabase,
  seedDatabase, sqlite, startWalCheckpointTimer, envRegistry,
} from "@grackle-ai/database";

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
});

describe("initializeDatabase", () => {
  it("calls openDatabase", () => {
    initializeDatabase();
    expect(openDatabase).toHaveBeenCalledOnce();
  });

  it("calls checkDatabaseIntegrity", () => {
    initializeDatabase();
    expect(checkDatabaseIntegrity).toHaveBeenCalledOnce();
  });

  it("calls initDatabase", () => {
    initializeDatabase();
    expect(initDatabase).toHaveBeenCalledOnce();
  });

  it("passes sqlite to seedDatabase", () => {
    initializeDatabase();
    expect(seedDatabase).toHaveBeenCalledWith(sqlite);
  });

  it("calls startWalCheckpointTimer", () => {
    initializeDatabase();
    expect(startWalCheckpointTimer).toHaveBeenCalledOnce();
  });

  it("resets all environment statuses", () => {
    initializeDatabase();
    expect(envRegistry.resetAllStatuses).toHaveBeenCalledOnce();
  });

  it("calls functions in correct order", () => {
    initializeDatabase();
    expect(callOrder).toEqual([
      "openDatabase",
      "checkDatabaseIntegrity",
      "initDatabase",
      "seedDatabase",
      "startWalCheckpointTimer",
      "resetAllStatuses",
    ]);
  });
});
