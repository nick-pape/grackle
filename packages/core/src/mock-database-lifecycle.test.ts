/**
 * Regression test: createDatabaseMock() registry lifecycle mirrors production.
 *
 * The real store-registry (packages/database/src/store-registry.ts) throws before
 * setDatabaseStores() is called. The mock must behave identically so tests cannot
 * silently pass in an environment where initialization would fail at runtime.
 */
import { describe, it, expect } from "vitest";
import { createDatabaseMock } from "@grackle-ai/test-utils";

describe("createDatabaseMock registry lifecycle", () => {
  it("throws before wire() is called (mirrors production throw-before-init)", () => {
    const mock = createDatabaseMock();
    expect(() => mock.getDatabaseStores()).toThrow("Database stores not initialized");
  });

  it("returns stores after wire()", () => {
    const mock = createDatabaseMock();
    mock.wire();
    const stores = mock.getDatabaseStores();
    expect(stores).toBeDefined();
    expect(typeof stores.sessionStore.createSession).toBe("function");
  });

  it("throws again after clearDatabaseStores()", () => {
    const mock = createDatabaseMock();
    mock.wire();
    mock.clearDatabaseStores();
    expect(() => mock.getDatabaseStores()).toThrow("Database stores not initialized");
  });

  it("setDatabaseStores() updates what getDatabaseStores() returns", () => {
    const mock = createDatabaseMock();
    mock.wire();
    const replacement = createDatabaseMock();
    replacement.wire();
    const replacementStores = replacement.getDatabaseStores();
    mock.setDatabaseStores(replacementStores as never);
    expect(mock.getDatabaseStores()).toBe(replacementStores);
  });
});
