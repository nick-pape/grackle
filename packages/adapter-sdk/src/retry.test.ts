/**
 * Smoke test — adapter-sdk re-exports retryWithBackoff from @grackle-ai/common.
 * The comprehensive behavioural tests live in packages/common/src/retry.test.ts.
 */
import { describe, it, expect } from "vitest";
import { retryWithBackoff } from "./retry.js";

describe("retryWithBackoff (re-export from common)", () => {
  it("is a function", () => {
    expect(typeof retryWithBackoff).toBe("function");
  });

  it("resolves on the first attempt", async () => {
    const result = await retryWithBackoff(() => Promise.resolve("ok"), {
      maxAttempts: 1,
      delayMs: 0,
    });
    expect(result).toBe("ok");
  });
});
