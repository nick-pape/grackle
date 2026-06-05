import { describe, it, expect, afterEach } from "vitest";
import { setDatabaseStores, getDatabaseStores, clearDatabaseStores } from "./store-registry.js";
import type { DatabaseStores } from "./store-types.js";

describe("store-registry", () => {
  afterEach(() => {
    clearDatabaseStores();
  });

  it("throws when accessed before initialization", () => {
    expect(() => getDatabaseStores()).toThrow("Database stores not initialized");
  });

  it("returns wired stores after set", () => {
    const mock = { sessionStore: {} } as unknown as DatabaseStores;
    setDatabaseStores(mock);
    expect(getDatabaseStores()).toBe(mock);
  });

  it("clears the registry", () => {
    const mock = { sessionStore: {} } as unknown as DatabaseStores;
    setDatabaseStores(mock);
    clearDatabaseStores();
    expect(() => getDatabaseStores()).toThrow("Database stores not initialized");
  });
});
