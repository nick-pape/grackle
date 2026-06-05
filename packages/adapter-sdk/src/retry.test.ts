import { describe, it, expect, vi, beforeEach } from "vitest";

import { retryWithBackoff } from "./retry.js";

const noopSleep = vi.fn(async (_ms: number) => {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retryWithBackoff", () => {
  it("returns on first attempt without sleeping", async () => {
    const result = await retryWithBackoff(() => Promise.resolve("ok"), {
      maxAttempts: 3,
      delayMs: 100,
      sleep: noopSleep,
    });

    expect(result).toBe("ok");
    expect(noopSleep).not.toHaveBeenCalled();
  });

  it("succeeds on Nth attempt after N-1 failures", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        throw new Error(`fail-${calls}`);
      }
      return "recovered";
    });

    const result = await retryWithBackoff(op, {
      maxAttempts: 5,
      delayMs: 100,
      sleep: noopSleep,
    });

    expect(result).toBe("recovered");
    expect(op).toHaveBeenCalledTimes(3);
    expect(noopSleep).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after exhausting maxAttempts", async () => {
    const op = vi.fn(async () => {
      throw new Error("always fails");
    });

    await expect(
      retryWithBackoff(op, { maxAttempts: 3, delayMs: 50, sleep: noopSleep }),
    ).rejects.toThrow("always fails");

    expect(op).toHaveBeenCalledTimes(3);
    expect(noopSleep).toHaveBeenCalledTimes(2);
  });

  it("uses fixed delay when backoffMultiplier is 1 (default)", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 4) {
        throw new Error("retry");
      }
      return "done";
    });

    await retryWithBackoff(op, { maxAttempts: 5, delayMs: 200, sleep: noopSleep });

    expect(noopSleep).toHaveBeenCalledTimes(3);
    for (const call of noopSleep.mock.calls) {
      expect(call[0]).toBe(200);
    }
  });

  it("applies exponential backoff with multiplier", async () => {
    const op = vi.fn(async () => {
      throw new Error("fail");
    });

    await expect(
      retryWithBackoff(op, {
        maxAttempts: 4,
        delayMs: 100,
        backoffMultiplier: 2,
        sleep: noopSleep,
      }),
    ).rejects.toThrow("fail");

    expect(noopSleep).toHaveBeenCalledTimes(3);
    expect(noopSleep.mock.calls[0]![0]).toBe(100);
    expect(noopSleep.mock.calls[1]![0]).toBe(200);
    expect(noopSleep.mock.calls[2]![0]).toBe(400);
  });

  it("caps delay at maxDelayMs", async () => {
    const op = vi.fn(async () => {
      throw new Error("fail");
    });

    await expect(
      retryWithBackoff(op, {
        maxAttempts: 5,
        delayMs: 100,
        backoffMultiplier: 10,
        maxDelayMs: 500,
        sleep: noopSleep,
      }),
    ).rejects.toThrow("fail");

    expect(noopSleep).toHaveBeenCalledTimes(4);
    expect(noopSleep.mock.calls[0]![0]).toBe(100);
    expect(noopSleep.mock.calls[1]![0]).toBe(500);
    expect(noopSleep.mock.calls[2]![0]).toBe(500);
    expect(noopSleep.mock.calls[3]![0]).toBe(500);
  });

  it("calls onRetry with attempt number and error", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        throw new Error(`err-${calls}`);
      }
      return "ok";
    });

    await retryWithBackoff(op, {
      maxAttempts: 5,
      delayMs: 50,
      onRetry,
      sleep: noopSleep,
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]![0]).toBe(1);
    expect((onRetry.mock.calls[0]![1] as Error).message).toBe("err-1");
    expect(onRetry.mock.calls[1]![0]).toBe(2);
    expect((onRetry.mock.calls[1]![1] as Error).message).toBe("err-2");
  });

  it("awaits async onRetry before sleeping", async () => {
    const order: string[] = [];
    const asyncOnRetry = vi.fn(async () => {
      order.push("onRetry-start");
      await Promise.resolve();
      order.push("onRetry-end");
    });
    const trackingSleep = vi.fn(async (_ms: number) => {
      order.push("sleep");
    });

    let calls = 0;
    await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 2) {
          throw new Error("fail");
        }
        return "ok";
      },
      { maxAttempts: 3, delayMs: 50, onRetry: asyncOnRetry, sleep: trackingSleep },
    );

    expect(order).toEqual(["onRetry-start", "onRetry-end", "sleep"]);
  });

  it("does not call onRetry on the final failed attempt", async () => {
    const onRetry = vi.fn();
    const op = vi.fn(async () => {
      throw new Error("fail");
    });

    await expect(
      retryWithBackoff(op, { maxAttempts: 2, delayMs: 50, onRetry, sleep: noopSleep }),
    ).rejects.toThrow("fail");

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toBe(1);
  });

  it("preserves non-Error throwables", async () => {
    const op = vi.fn(async () => {
      throw "string-error";
    });

    await expect(
      retryWithBackoff(op, { maxAttempts: 2, delayMs: 50, sleep: noopSleep }),
    ).rejects.toBe("string-error");
  });
});
