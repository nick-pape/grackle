import { describe, expect, it } from "vitest";
import {
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
  REMOTE_COPY_TIMEOUT_MS,
  CONNECT_RETRY_DELAY_MS,
  CONNECT_MAX_RETRIES,
  TUNNEL_PORT_POLL_DELAY_MS,
  TUNNEL_PORT_POLL_MAX_ATTEMPTS,
  TUNNEL_KILL_GRACE_MS,
  REVERSE_TUNNEL_SETTLE_MS,
} from "./constants.js";

describe("adapter-sdk constants", () => {
  it("SSH_CONNECTIVITY_TIMEOUT_MS is 15 seconds", () => {
    expect(SSH_CONNECTIVITY_TIMEOUT_MS).toBe(15_000);
  });

  it("REMOTE_EXEC_DEFAULT_TIMEOUT_MS is 60 seconds", () => {
    expect(REMOTE_EXEC_DEFAULT_TIMEOUT_MS).toBe(60_000);
  });

  it("REMOTE_COPY_TIMEOUT_MS is 120 seconds", () => {
    expect(REMOTE_COPY_TIMEOUT_MS).toBe(120_000);
  });

  it("CONNECT_RETRY_DELAY_MS is 1.5 seconds", () => {
    expect(CONNECT_RETRY_DELAY_MS).toBe(1_500);
  });

  it("CONNECT_MAX_RETRIES is 10", () => {
    expect(CONNECT_MAX_RETRIES).toBe(10);
  });

  it("TUNNEL_PORT_POLL_DELAY_MS is 500ms", () => {
    expect(TUNNEL_PORT_POLL_DELAY_MS).toBe(500);
  });

  it("TUNNEL_PORT_POLL_MAX_ATTEMPTS is 20", () => {
    expect(TUNNEL_PORT_POLL_MAX_ATTEMPTS).toBe(20);
  });

  it("TUNNEL_KILL_GRACE_MS is 1 second", () => {
    expect(TUNNEL_KILL_GRACE_MS).toBe(1_000);
  });

  it("REVERSE_TUNNEL_SETTLE_MS is 3 seconds", () => {
    expect(REVERSE_TUNNEL_SETTLE_MS).toBe(3_000);
  });
});
