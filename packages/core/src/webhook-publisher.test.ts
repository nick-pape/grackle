import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// noSleep must be hoisted so it's defined when the vi.mock factory runs.
const noSleep = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Patch adapter-sdk's retryWithBackoff to inject a no-op sleep so retries are instant.
vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/adapter-sdk")>();
  return {
    ...original,
    retryWithBackoff: async <T>(
      operation: () => Promise<T>,
      options: Parameters<typeof original.retryWithBackoff>[1],
    ): Promise<T> => original.retryWithBackoff(operation, { ...options, sleep: noSleep }),
  };
});

// postWebhook is imported after mocks
import { postWebhook } from "./webhook-publisher.js";

describe("webhook-publisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it("POSTs JSON to the given URL on success", async () => {
    await postWebhook("https://hooks.example.com/test", { type: "test", value: 42 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.example.com/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", value: 42 }),
      }),
    );
  });

  it("resolves without retrying when the first attempt succeeds", async () => {
    await postWebhook("https://hooks.example.com/test", {});

    expect(fetch).toHaveBeenCalledOnce();
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries on network failure and succeeds on second attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({ ok: true, status: 200 }),
    );

    await postWebhook("https://hooks.example.com/test", {});

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledOnce();
  });

  it("retries on non-2xx response and succeeds on second attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValue({ ok: true, status: 200 }),
    );

    await postWebhook("https://hooks.example.com/test", {});

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after all attempts are exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Persistent failure")));

    await expect(postWebhook("https://hooks.example.com/test", {})).rejects.toThrow(
      "Persistent failure",
    );

    // 3 attempts total (WEBHOOK_MAX_ATTEMPTS = 3)
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("logs a warning on each retry attempt", async () => {
    const { logger } = await import("./logger.js");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("flaky")));

    await expect(postWebhook("https://hooks.example.com/test", {})).rejects.toThrow();

    // 2 retries = 2 warn calls (not called on the final exhaustion — retryWithBackoff only
    // calls onRetry before each sleep, not after the last failure)
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://hooks.example.com/test" }),
      "Webhook delivery failed, retrying",
    );
  });

  it("treats non-2xx as a retriable failure (not just network errors)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await expect(postWebhook("https://hooks.example.com/test", {})).rejects.toThrow("HTTP 429");

    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
