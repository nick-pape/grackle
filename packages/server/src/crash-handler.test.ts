import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock dependencies before importing ──────────────
// vi.mock factories are hoisted — cannot reference variables declared outside.

vi.mock("@grackle-ai/core", () => ({
  logger: {
    fatal: vi.fn(),
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

import { handleFatalError, registerCrashHandlers } from "./crash-handler.js";
import { logger } from "@grackle-ai/core";
import { stopWalCheckpointTimer } from "@grackle-ai/database";

// eslint-disable-next-line @typescript-eslint/naming-convention
const { __setSqlite } = await import("@grackle-ai/database") as unknown as {
  __setSqlite: (val: { pragma: ReturnType<typeof vi.fn> } | undefined) => void;
};

const mockProcessExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
const mockProcessOn = vi.spyOn(process, "on");

beforeEach(() => {
  vi.clearAllMocks();
  __setSqlite({ pragma: mockPragma });
});

afterEach(() => {
  mockProcessExit.mockClear();
  mockProcessOn.mockClear();
});

describe("handleFatalError", () => {
  it("calls logger.fatal with the error and label", () => {
    const err = new Error("boom");
    handleFatalError(err, "Uncaught exception");

    expect(logger.fatal).toHaveBeenCalledWith(
      { err },
      "%s — flushing WAL and exiting",
      "Uncaught exception",
    );
  });

  it("calls stopWalCheckpointTimer", () => {
    handleFatalError(new Error("test"), "test");
    expect(stopWalCheckpointTimer).toHaveBeenCalled();
  });

  it("attempts WAL checkpoint when sqlite is available", () => {
    handleFatalError(new Error("test"), "test");
    expect(mockPragma).toHaveBeenCalledWith("wal_checkpoint(TRUNCATE)");
  });

  it("does not throw if WAL checkpoint fails", () => {
    mockPragma.mockImplementation(() => { throw new Error("WAL error"); });
    expect(() => handleFatalError(new Error("test"), "test")).not.toThrow();
  });

  it("skips WAL checkpoint when sqlite is undefined", () => {
    __setSqlite(undefined);
    handleFatalError(new Error("test"), "test");
    expect(mockPragma).not.toHaveBeenCalled();
  });

  it("exits with code 1", () => {
    handleFatalError(new Error("test"), "test");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

describe("registerCrashHandlers", () => {
  it("registers uncaughtException and unhandledRejection handlers", () => {
    registerCrashHandlers();

    const eventNames = mockProcessOn.mock.calls.map((call) => call[0]);
    expect(eventNames).toContain("uncaughtException");
    expect(eventNames).toContain("unhandledRejection");
  });
});
