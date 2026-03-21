import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock neo4j-driver — use vi.hoisted() so variables are available in the
// hoisted vi.mock() factory.
// ---------------------------------------------------------------------------

const {
  mockClose,
  mockVerifyConnectivity,
  mockSessionClose,
  mockSessionRun,
  mockSession,
  mockDriverInstance,
  mockDriverConstructor,
  mockBasicAuth,
} = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockVerifyConnectivity = vi.fn().mockResolvedValue(undefined);
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
  const mockSession = {
    close: mockSessionClose,
    run: mockSessionRun,
  };
  const mockDriverInstance = {
    close: mockClose,
    verifyConnectivity: mockVerifyConnectivity,
    session: vi.fn().mockReturnValue(mockSession),
  };
  const mockDriverConstructor = vi.fn().mockReturnValue(mockDriverInstance);
  const mockBasicAuth = vi.fn().mockReturnValue({ scheme: "basic" });

  return {
    mockClose,
    mockVerifyConnectivity,
    mockSessionClose,
    mockSessionRun,
    mockSession,
    mockDriverInstance,
    mockDriverConstructor,
    mockBasicAuth,
  };
});

vi.mock("neo4j-driver", () => ({
  default: {
    driver: mockDriverConstructor,
    auth: { basic: mockBasicAuth },
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  openNeo4j,
  closeNeo4j,
  healthCheck,
  getDriver,
  getSession,
} from "./client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the module-level singleton between tests by closing any open driver. */
async function resetClient(): Promise<void> {
  await closeNeo4j();
  mockDriverConstructor.mockClear();
  mockBasicAuth.mockClear();
  mockClose.mockClear();
  mockVerifyConnectivity.mockClear();
  mockDriverInstance.session.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openNeo4j", () => {
  beforeEach(async () => {
    await resetClient();
    delete process.env.GRACKLE_NEO4J_URL;
    delete process.env.GRACKLE_NEO4J_USER;
    delete process.env.GRACKLE_NEO4J_PASSWORD;
    delete process.env.GRACKLE_NEO4J_DATABASE;
  });

  afterEach(async () => {
    await resetClient();
  });

  it("creates a driver with default config", async () => {
    await openNeo4j();

    expect(mockBasicAuth).toHaveBeenCalledWith("neo4j", "grackle-dev");
    expect(mockDriverConstructor).toHaveBeenCalledWith(
      "bolt://localhost:7687",
      { scheme: "basic" },
      expect.objectContaining({ disableLosslessIntegers: true }),
    );
    expect(mockVerifyConnectivity).toHaveBeenCalled();
  });

  it("uses config parameter values", async () => {
    await openNeo4j({
      url: "bolt://custom:7688",
      username: "admin",
      password: "secret",
      database: "mydb",
    });

    expect(mockBasicAuth).toHaveBeenCalledWith("admin", "secret");
    expect(mockDriverConstructor).toHaveBeenCalledWith(
      "bolt://custom:7688",
      expect.anything(),
      expect.anything(),
    );
    expect(mockVerifyConnectivity).toHaveBeenCalledWith({ database: "mydb" });
  });

  it("prefers env vars over config", async () => {
    process.env.GRACKLE_NEO4J_URL = "bolt://env-host:9999";
    process.env.GRACKLE_NEO4J_USER = "env-user";
    process.env.GRACKLE_NEO4J_PASSWORD = "env-pass";
    process.env.GRACKLE_NEO4J_DATABASE = "env-db";

    await openNeo4j({
      url: "bolt://config-host:1111",
      username: "config-user",
      password: "config-pass",
      database: "config-db",
    });

    expect(mockBasicAuth).toHaveBeenCalledWith("env-user", "env-pass");
    expect(mockDriverConstructor).toHaveBeenCalledWith(
      "bolt://env-host:9999",
      expect.anything(),
      expect.anything(),
    );
    expect(mockVerifyConnectivity).toHaveBeenCalledWith({ database: "env-db" });
  });

  it("is idempotent — second call is a no-op", async () => {
    await openNeo4j();
    await openNeo4j();

    expect(mockDriverConstructor).toHaveBeenCalledTimes(1);
  });

  it("cleans up and throws when connectivity check fails", async () => {
    mockVerifyConnectivity.mockRejectedValueOnce(
      new Error("connection refused"),
    );

    await expect(openNeo4j()).rejects.toThrow("Failed to connect to Neo4j");
    expect(mockClose).toHaveBeenCalled();

    // Singleton should be reset — a retry should attempt to create a new driver
    mockVerifyConnectivity.mockResolvedValueOnce(undefined);
    mockClose.mockClear();
    mockDriverConstructor.mockClear();

    await openNeo4j();
    expect(mockDriverConstructor).toHaveBeenCalledTimes(1);
  });
});

describe("getDriver", () => {
  beforeEach(async () => {
    await resetClient();
  });

  it("throws when not initialized", () => {
    expect(() => getDriver()).toThrow("Neo4j not initialized");
  });

  it("returns the driver after initialization", async () => {
    await openNeo4j();
    expect(getDriver()).toBe(mockDriverInstance);
  });
});

describe("getSession", () => {
  beforeEach(async () => {
    await resetClient();
  });

  it("throws when not initialized", () => {
    expect(() => getSession()).toThrow("Neo4j not initialized");
  });

  it("returns a session after initialization", async () => {
    await openNeo4j();
    const session = getSession();
    expect(session).toBe(mockSession);
    expect(mockDriverInstance.session).toHaveBeenCalledWith({
      database: "neo4j",
    });
  });
});

describe("healthCheck", () => {
  beforeEach(async () => {
    await resetClient();
  });

  it("returns false when not initialized", async () => {
    expect(await healthCheck()).toBe(false);
  });

  it("returns true when connectivity succeeds", async () => {
    await openNeo4j();
    expect(await healthCheck()).toBe(true);
  });

  it("returns false when connectivity fails", async () => {
    await openNeo4j();
    mockVerifyConnectivity.mockRejectedValueOnce(new Error("timeout"));

    expect(await healthCheck()).toBe(false);
  });
});

describe("closeNeo4j", () => {
  beforeEach(async () => {
    await resetClient();
  });

  it("closes the driver and resets singleton", async () => {
    await openNeo4j();
    await closeNeo4j();

    expect(mockClose).toHaveBeenCalled();
    expect(() => getDriver()).toThrow("Neo4j not initialized");
  });

  it("is safe to call when already closed", async () => {
    await closeNeo4j();
    // Should not throw
  });
});
