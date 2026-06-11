import { describe, expect, it } from "vitest";
import {
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_RETRIES,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
  PROBE_INTERVAL_MS,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAY_MS,
  WEBHOOK_BACKOFF_MULTIPLIER,
  WEBHOOK_MAX_DELAY_MS,
  GH_AUTH_STATUS_TIMEOUT_MS,
  GH_AUTH_TOKEN_TIMEOUT_MS,
} from "./constants.js";

describe("core constants", () => {
  it("RECONNECT_INITIAL_DELAY_MS is 10 seconds", () => {
    expect(RECONNECT_INITIAL_DELAY_MS).toBe(10_000);
  });

  it("RECONNECT_MAX_RETRIES is 5", () => {
    expect(RECONNECT_MAX_RETRIES).toBe(5);
  });

  it("RECONNECT_MAX_DELAY_MS is 120 seconds", () => {
    expect(RECONNECT_MAX_DELAY_MS).toBe(120_000);
  });

  it("RECONNECT_BACKOFF_MULTIPLIER is 2", () => {
    expect(RECONNECT_BACKOFF_MULTIPLIER).toBe(2);
  });

  it("PROBE_INTERVAL_MS is 60 seconds", () => {
    expect(PROBE_INTERVAL_MS).toBe(60_000);
  });

  it("WEBHOOK_TIMEOUT_MS is 10 seconds", () => {
    expect(WEBHOOK_TIMEOUT_MS).toBe(10_000);
  });

  it("WEBHOOK_MAX_ATTEMPTS is 3", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(3);
  });

  it("WEBHOOK_RETRY_DELAY_MS is 500ms", () => {
    expect(WEBHOOK_RETRY_DELAY_MS).toBe(500);
  });

  it("WEBHOOK_BACKOFF_MULTIPLIER is 2", () => {
    expect(WEBHOOK_BACKOFF_MULTIPLIER).toBe(2);
  });

  it("WEBHOOK_MAX_DELAY_MS is 5 seconds", () => {
    expect(WEBHOOK_MAX_DELAY_MS).toBe(5_000);
  });

  it("GH_AUTH_STATUS_TIMEOUT_MS is 10 seconds", () => {
    expect(GH_AUTH_STATUS_TIMEOUT_MS).toBe(10_000);
  });

  it("GH_AUTH_TOKEN_TIMEOUT_MS is 5 seconds", () => {
    expect(GH_AUTH_TOKEN_TIMEOUT_MS).toBe(5_000);
  });
});
