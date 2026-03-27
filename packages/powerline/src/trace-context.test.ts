import { describe, it, expect } from "vitest";
import { getTraceId, runWithTrace } from "./trace-context.js";

describe("powerline trace-context", () => {
  describe("getTraceId()", () => {
    it("returns undefined when no context is active", () => {
      expect(getTraceId()).toBeUndefined();
    });
  });

  describe("runWithTrace()", () => {
    it("makes traceId available inside a sync callback", () => {
      let captured: string | undefined;
      runWithTrace("pl-123", () => {
        captured = getTraceId();
      });
      expect(captured).toBe("pl-123");
    });

    it("makes traceId available inside an async callback", async () => {
      let captured: string | undefined;
      await runWithTrace("pl-async", async () => {
        await Promise.resolve();
        captured = getTraceId();
      });
      expect(captured).toBe("pl-async");
    });

    it("isolates traceId between concurrent async operations", async () => {
      const results: string[] = [];

      const op1 = runWithTrace("pl-op-1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(`op1:${getTraceId()}`);
      });

      const op2 = runWithTrace("pl-op-2", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(`op2:${getTraceId()}`);
      });

      await Promise.all([op1, op2]);

      expect(results).toContain("op1:pl-op-1");
      expect(results).toContain("op2:pl-op-2");
    });

    it("context does not leak after runWithTrace completes", () => {
      runWithTrace("temporary", () => {
        // context active
      });
      expect(getTraceId()).toBeUndefined();
    });
  });
});
