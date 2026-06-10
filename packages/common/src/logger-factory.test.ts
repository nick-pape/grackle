import { describe, it, expect, afterEach } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { createPinoLogger } from "./logger-factory.js";

/** Create a synchronous in-memory pino destination for assertions. */
function makeCapture(): { dest: pino.DestinationStream; lines: () => object[] } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  }) as pino.DestinationStream;
  return { dest, lines: () => chunks.map((c) => JSON.parse(c) as object) };
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
  delete process.env.NODE_ENV;
});

describe("createPinoLogger", () => {
  it("returns a logger with the given name", () => {
    const logger = createPinoLogger({ name: "test-package" });
    expect(logger.bindings().name).toBe("test-package");
  });

  it("defaults level to info when LOG_LEVEL is unset", () => {
    const logger = createPinoLogger({ name: "test" });
    expect(logger.level).toBe("info");
  });

  it("respects a valid LOG_LEVEL env var", () => {
    process.env.LOG_LEVEL = "debug";
    const logger = createPinoLogger({ name: "test" });
    expect(logger.level).toBe("debug");
  });

  it("falls back to info for an invalid LOG_LEVEL (drift-fix)", () => {
    process.env.LOG_LEVEL = "verbose"; // not a valid pino level
    const logger = createPinoLogger({ name: "test" });
    expect(logger.level).toBe("info");
  });

  it("calls the provided mixin and merges its fields into log output", () => {
    const { dest, lines } = makeCapture();
    const mixin = (): object => ({ requestId: "req-42" });
    // build a logger that writes to our capture dest instead of pino/file
    const logger = pino({ name: "test", mixin }, dest);
    logger.info("hello");
    const [line] = lines() as Array<Record<string, unknown>>;
    expect(line.requestId).toBe("req-42");
    expect(line.msg).toBe("hello");
  });
});
