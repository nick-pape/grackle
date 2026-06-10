import { describe, it, expect, vi, afterEach } from "vitest";
import { createPinoLogger } from "./logger-factory.js";

afterEach(() => {
  delete process.env.LOG_LEVEL;
  delete process.env.NODE_ENV;
  vi.restoreAllMocks();
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

  it("passes mixin through createPinoLogger so it is called on every log", () => {
    const mixin = vi.fn((): object => ({ requestId: "req-42" }));
    // Use production mode so pino writes synchronously (no pino/file worker thread)
    // which ensures the mixin is invoked before the logger call returns.
    process.env.NODE_ENV = "production";
    const logger = createPinoLogger({ name: "test", mixin });
    logger.info("hello");
    expect(mixin).toHaveBeenCalled();
  });
});
