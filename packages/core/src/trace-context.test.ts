import { describe, it, expect } from "vitest";
import { getTraceId, runWithTrace } from "./trace-context.js";

describe("trace-context", () => {
  describe("getTraceId()", () => {
    it("returns undefined when no context is active", () => {
      expect(getTraceId()).toBeUndefined();
    });
  });

  describe("runWithTrace()", () => {
    it("makes traceId available inside a sync callback", () => {
      let captured: string | undefined;
      runWithTrace("abc-123", () => {
        captured = getTraceId();
      });
      expect(captured).toBe("abc-123");
    });

    it("makes traceId available inside an async callback", async () => {
      let captured: string | undefined;
      await runWithTrace("async-456", async () => {
        await Promise.resolve();
        captured = getTraceId();
      });
      expect(captured).toBe("async-456");
    });

    it("uses innermost traceId when nested", () => {
      let outer: string | undefined;
      let inner: string | undefined;
      runWithTrace("outer", () => {
        outer = getTraceId();
        runWithTrace("inner", () => {
          inner = getTraceId();
        });
      });
      expect(outer).toBe("outer");
      expect(inner).toBe("inner");
    });

    it("restores previous context after nested call completes", () => {
      let afterInner: string | undefined;
      runWithTrace("outer", () => {
        runWithTrace("inner", () => {
          // inner context active
        });
        afterInner = getTraceId();
      });
      expect(afterInner).toBe("outer");
    });

    it("isolates traceId between concurrent async operations", async () => {
      const results: string[] = [];

      const op1 = runWithTrace("op-1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(`op1:${getTraceId()}`);
      });

      const op2 = runWithTrace("op-2", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(`op2:${getTraceId()}`);
      });

      await Promise.all([op1, op2]);

      expect(results).toContain("op1:op-1");
      expect(results).toContain("op2:op-2");
    });

    it("returns the callback's return value", () => {
      const result = runWithTrace("trace-id", () => 42);
      expect(result).toBe(42);
    });

    it("context does not leak after runWithTrace completes", () => {
      runWithTrace("temporary", () => {
        // context active
      });
      expect(getTraceId()).toBeUndefined();
    });
  });
});
