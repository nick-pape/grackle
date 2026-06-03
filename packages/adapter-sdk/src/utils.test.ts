import { describe, it, expect, vi } from "vitest";
import { isPortConflictError, withFreePort, findFreePort } from "./utils.js";

// ─── isPortConflictError ────────────────────────────────────

describe("isPortConflictError", () => {
  it("returns true for EADDRINUSE", () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    expect(isPortConflictError(err)).toBe(true);
  });

  it("returns true for Docker port-already-allocated message", () => {
    const err = new Error(
      "Error response from daemon: driver failed programming external connectivity: port is already allocated",
    );
    expect(isPortConflictError(err)).toBe(true);
  });

  it("returns true for address-already-in-use message (SSH / generic)", () => {
    const err = new Error("bind: Address already in use");
    expect(isPortConflictError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isPortConflictError(new Error("connection refused"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isPortConflictError("EADDRINUSE")).toBe(false);
    expect(isPortConflictError(null)).toBe(false);
    expect(isPortConflictError(undefined)).toBe(false);
  });
});

// ─── findFreePort ───────────────────────────────────────────

describe("findFreePort", () => {
  it("returns a valid ephemeral port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

// ─── withFreePort ───────────────────────────────────────────

describe("withFreePort", () => {
  it("returns the action result on first success", async () => {
    const result = await withFreePort(async (port) => `bound:${port}`);
    expect(result).toMatch(/^bound:\d+$/);
  });

  it("retries on port-conflict error and eventually succeeds", async () => {
    let callCount = 0;
    const result = await withFreePort(async (port) => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
      }
      return `ok:${port}`;
    });
    expect(callCount).toBe(2);
    expect(result).toMatch(/^ok:\d+$/);
  });

  it("throws after exhausting all attempts", async () => {
    const err = Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" });
    const action = vi.fn().mockRejectedValue(err);

    await expect(withFreePort(action, 3)).rejects.toThrow("EADDRINUSE");
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-port-conflict errors", async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error("timeout"));

    await expect(withFreePort(action)).rejects.toThrow("timeout");
    expect(action).toHaveBeenCalledOnce();
  });

  it("rejects invalid maxAttempts values", async () => {
    const action = vi.fn();
    await expect(withFreePort(action, 0)).rejects.toThrow(RangeError);
    await expect(withFreePort(action, -1)).rejects.toThrow(RangeError);
    await expect(withFreePort(action, 1.5)).rejects.toThrow(RangeError);
    expect(action).not.toHaveBeenCalled();
  });
});
