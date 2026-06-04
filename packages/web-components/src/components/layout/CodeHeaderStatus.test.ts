import { describe, it, expect } from "vitest";
import type { Session } from "../../hooks/types.js";
import { describeCodeStatus } from "./CodeHeaderStatus.js";

/** Build a session with sensible defaults, overridable per-test. */
function makeSession(over: Partial<Session> & { id: string }): Session {
  return {
    environmentId: "env-1",
    runtime: "claude-code",
    status: "running",
    prompt: "Do the thing",
    startedAt: "2026-02-27T08:00:00Z",
    ...over,
  };
}

describe("describeCodeStatus", () => {
  it("returns zero active and undefined lastActivityAt for empty sessions", () => {
    const result = describeCodeStatus([]);
    expect(result).toEqual({ activeCount: 0, lastActivityAt: undefined });
  });

  it("counts all running sessions as active", () => {
    const sessions = [
      makeSession({ id: "s1", status: "running", startedAt: "2026-06-01T10:00:00Z" }),
      makeSession({ id: "s2", status: "running", startedAt: "2026-06-01T11:00:00Z" }),
      makeSession({ id: "s3", status: "running", startedAt: "2026-06-01T12:00:00Z" }),
    ];
    const result = describeCodeStatus(sessions);
    expect(result.activeCount).toBe(3);
    expect(result.lastActivityAt).toBe("2026-06-01T12:00:00Z");
  });

  it("distinguishes active from ended sessions", () => {
    const sessions = [
      makeSession({ id: "s1", status: "running", startedAt: "2026-06-01T10:00:00Z" }),
      makeSession({ id: "s2", status: "running", startedAt: "2026-06-01T11:00:00Z" }),
      makeSession({
        id: "s3",
        status: "completed",
        endReason: "completed",
        startedAt: "2026-06-01T12:00:00Z",
      }),
    ];
    const result = describeCodeStatus(sessions);
    expect(result.activeCount).toBe(2);
    expect(result.lastActivityAt).toBe("2026-06-01T12:00:00Z");
  });

  it("returns zero active when all sessions are ended", () => {
    const sessions = [
      makeSession({
        id: "s1",
        status: "completed",
        endReason: "completed",
        startedAt: "2026-06-01T10:00:00Z",
      }),
      makeSession({
        id: "s2",
        status: "error",
        endReason: "error",
        startedAt: "2026-06-01T09:00:00Z",
      }),
    ];
    const result = describeCodeStatus(sessions);
    expect(result.activeCount).toBe(0);
    expect(result.lastActivityAt).toBe("2026-06-01T10:00:00Z");
  });

  it("picks the latest startedAt regardless of session order", () => {
    const sessions = [
      makeSession({ id: "s1", status: "running", startedAt: "2026-06-01T12:00:00Z" }),
      makeSession({ id: "s2", status: "running", startedAt: "2026-06-01T08:00:00Z" }),
      makeSession({ id: "s3", status: "running", startedAt: "2026-06-01T15:00:00Z" }),
      makeSession({ id: "s4", status: "running", startedAt: "2026-06-01T10:00:00Z" }),
    ];
    const result = describeCodeStatus(sessions);
    expect(result.lastActivityAt).toBe("2026-06-01T15:00:00Z");
  });
});
