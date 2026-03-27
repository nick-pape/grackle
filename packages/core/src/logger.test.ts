import { describe, it, expect, vi, beforeEach } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";

// Mock trace-context before importing logger
vi.mock("./trace-context.js", () => ({
  getTraceId: vi.fn(),
}));

import { getTraceId } from "./trace-context.js";
import { createLoggerMixin } from "./logger.js";

const mockedGetTraceId = vi.mocked(getTraceId);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Create a pino logger that writes JSON lines to a buffer for inspection. */
function createTestLogger(): { logger: pino.Logger; getLines: () => object[] } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const testLogger = pino({ mixin: createLoggerMixin }, dest);
  return {
    logger: testLogger,
    getLines: () => chunks.map((c) => JSON.parse(c) as object),
  };
}

describe("logger mixin (traceId injection)", () => {
  it("includes traceId in log output when trace context is active", () => {
    mockedGetTraceId.mockReturnValue("trace-abc");
    const { logger, getLines } = createTestLogger();

    logger.info("test message");

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveProperty("traceId", "trace-abc");
    expect(lines[0]).toHaveProperty("msg", "test message");
  });

  it("omits traceId field when no trace context is active", () => {
    mockedGetTraceId.mockReturnValue(undefined);
    const { logger, getLines } = createTestLogger();

    logger.info("no trace");

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty("traceId");
    expect(lines[0]).toHaveProperty("msg", "no trace");
  });

  it("merges traceId with explicit structured fields", () => {
    mockedGetTraceId.mockReturnValue("trace-merge");
    const { logger, getLines } = createTestLogger();

    logger.info({ environmentId: "env-1", sessionId: "sess-2" }, "merged fields");

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveProperty("traceId", "trace-merge");
    expect(lines[0]).toHaveProperty("environmentId", "env-1");
    expect(lines[0]).toHaveProperty("sessionId", "sess-2");
  });
});
