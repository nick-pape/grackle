import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from "vitest";

// ── Mock dependencies before importing ──────────────

vi.mock("@grackle-ai/core", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockPragma = vi.fn();

vi.mock("@grackle-ai/database", () => {
  let sqliteInstance: { pragma: ReturnType<typeof vi.fn> } | undefined;
  return {
    get sqlite() { return sqliteInstance; },
    __setSqlite(val: { pragma: ReturnType<typeof vi.fn> } | undefined): void { sqliteInstance = val; },
    stopWalCheckpointTimer: vi.fn(),
  };
});

vi.mock("@grackle-ai/auth", () => ({
  stopPairingCleanup: vi.fn(),
  stopSessionCleanup: vi.fn(),
  stopOAuthCleanup: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-sdk", () => ({
  closeAllTunnels: vi.fn(async () => {}),
}));

import { createShutdown, type ShutdownContext } from "./shutdown.js";
import { logger } from "@grackle-ai/core";
import { stopWalCheckpointTimer } from "@grackle-ai/database";
import { stopPairingCleanup, stopSessionCleanup, stopOAuthCleanup } from "@grackle-ai/auth";
import { closeAllTunnels } from "@grackle-ai/adapter-sdk";

// eslint-disable-next-line @typescript-eslint/naming-convention
const { __setSqlite } = await import("@grackle-ai/database") as unknown as {
  __setSqlite: (val: { pragma: ReturnType<typeof vi.fn> } | undefined) => void;
};

const mockProcessExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

afterAll(() => {
  mockProcessExit.mockRestore();
});

/** Build a mock ShutdownContext with all fields. */
function createMockContext(overrides?: Partial<ShutdownContext>): ShutdownContext {
  return {
    grpcServer: { close: vi.fn((cb: (err?: Error) => void) => { cb(); }) },
    webServer: { close: vi.fn((cb: (err?: Error) => void) => { cb(); }) },
    mcpServer: { close: vi.fn((cb: (err?: Error) => void) => { cb(); }) },
    reconciliationManager: { stop: vi.fn(async () => {}) },
    localPowerLineManager: { stop: vi.fn(async () => {}) },
    knowledgeCleanup: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __setSqlite({ pragma: mockPragma });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createShutdown", () => {
  it("returns a function", () => {
    const shutdown = createShutdown(createMockContext());
    expect(typeof shutdown).toBe("function");
  });

  it("stops WAL checkpoint timer", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(stopWalCheckpointTimer).toHaveBeenCalledOnce();
  });

  it("stops pairing cleanup", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(stopPairingCleanup).toHaveBeenCalledOnce();
  });

  it("stops session cleanup", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(stopSessionCleanup).toHaveBeenCalledOnce();
  });

  it("stops OAuth cleanup", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(stopOAuthCleanup).toHaveBeenCalledOnce();
  });

  it("stops reconciliation manager", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.reconciliationManager.stop).toHaveBeenCalledOnce();
  });

  it("stops PowerLine manager when present", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.localPowerLineManager!.stop).toHaveBeenCalledOnce();
  });

  it("skips PowerLine stop when manager is undefined", async () => {
    const ctx = createMockContext({ localPowerLineManager: undefined });
    const shutdown = createShutdown(ctx);
    // Should not throw
    await shutdown();
  });

  it("calls knowledgeCleanup when present", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.knowledgeCleanup).toHaveBeenCalledOnce();
  });

  it("skips knowledgeCleanup when undefined", async () => {
    const ctx = createMockContext({ knowledgeCleanup: undefined });
    const shutdown = createShutdown(ctx);
    // Should not throw
    await shutdown();
  });

  it("logs error but continues when knowledgeCleanup throws", async () => {
    const ctx = createMockContext({
      knowledgeCleanup: vi.fn(async () => { throw new Error("neo4j down"); }),
    });
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error while shutting down knowledge graph",
    );
    // Should still close servers (not bail out)
    expect(ctx.grpcServer.close).toHaveBeenCalled();
  });

  it("closes all tunnels", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(closeAllTunnels).toHaveBeenCalledOnce();
  });

  it("closes gRPC server", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.grpcServer.close).toHaveBeenCalledOnce();
  });

  it("closes web server", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.webServer.close).toHaveBeenCalledOnce();
  });

  it("closes MCP server", async () => {
    const ctx = createMockContext();
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(ctx.mcpServer.close).toHaveBeenCalledOnce();
  });

  it("handles server close errors gracefully", async () => {
    const ctx = createMockContext({
      grpcServer: { close: vi.fn((cb: (err?: Error) => void) => { cb(new Error("close error")); }) },
    });
    const shutdown = createShutdown(ctx);
    await shutdown();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error while closing gRPC server",
    );
  });

  it("runs final WAL checkpoint when sqlite is available", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(mockPragma).toHaveBeenCalledWith("wal_checkpoint(TRUNCATE)");
  });

  it("logs error and continues if WAL checkpoint throws", async () => {
    mockPragma.mockImplementation(() => { throw new Error("WAL error"); });
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error during final WAL checkpoint",
    );
    // Should still exit cleanly
    expect(mockProcessExit).toHaveBeenCalledWith(0);
  });

  it("skips final WAL checkpoint when sqlite is undefined", async () => {
    __setSqlite(undefined);
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(mockPragma).not.toHaveBeenCalled();
  });

  it("calls process.exit with exitCode or 0", async () => {
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(mockProcessExit).toHaveBeenCalledWith(0);
  });

  it("sets up hard timeout that forces exit", async () => {
    vi.useFakeTimers();

    // Make one server hang so shutdown doesn't complete
    const ctx = createMockContext({
      grpcServer: { close: vi.fn(() => { /* never calls callback */ }) },
    });
    const shutdown = createShutdown(ctx);
    const shutdownPromise = shutdown();

    // Advance past the hard timeout
    await vi.advanceTimersByTimeAsync(6_000);

    expect(mockProcessExit).toHaveBeenCalledWith(1);

    // Clean up the hanging promise
    vi.useRealTimers();
    await Promise.race([shutdownPromise, Promise.resolve()]);
  });

  it("clears hard timeout after clean shutdown", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const shutdown = createShutdown(createMockContext());
    await shutdown();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
