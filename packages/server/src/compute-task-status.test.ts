import { describe, it, expect } from "vitest";
import { computeTaskStatus } from "./compute-task-status.js";
import type { SessionRow } from "./schema.js";

type SessionInput = Pick<SessionRow, "id" | "status" | "startedAt">;

function makeSession(
  id: string,
  status: string,
  startedAt: string = "2025-01-01T00:00:00Z",
): SessionInput {
  return { id, status, startedAt };
}

describe("computeTaskStatus", () => {
  // ── No sessions ──────────────────────────────────────────────────
  describe("no sessions", () => {
    it("returns 'not_started' when no sessions exist", () => {
      expect(computeTaskStatus("not_started", [])).toEqual({
        status: "not_started",
        latestSessionId: "",
      });
    });

    it("clamps transient status 'working' to 'not_started' when no sessions", () => {
      expect(computeTaskStatus("working", [])).toEqual({
        status: "not_started",
        latestSessionId: "",
      });
    });

    it("clamps transient status 'paused' to 'not_started' when no sessions", () => {
      expect(computeTaskStatus("paused", [])).toEqual({
        status: "not_started",
        latestSessionId: "",
      });
    });

    it("preserves 'failed' with no sessions", () => {
      expect(computeTaskStatus("failed", [])).toEqual({
        status: "failed",
        latestSessionId: "",
      });
    });

    it("preserves 'complete' with no sessions", () => {
      expect(computeTaskStatus("complete", [])).toEqual({
        status: "complete",
        latestSessionId: "",
      });
    });
  });

  // ── Sticky statuses ──────────────────────────────────────────────
  describe("sticky statuses", () => {
    it("'complete' is sticky even with active sessions", () => {
      const sessions = [makeSession("s1", "running", "2025-01-01T00:00:00Z")];
      expect(computeTaskStatus("complete", sessions)).toEqual({
        status: "complete",
        latestSessionId: "s1",
      });
    });

    it("'complete' is sticky with no sessions", () => {
      expect(computeTaskStatus("complete", [])).toEqual({
        status: "complete",
        latestSessionId: "",
      });
    });

    it("'not_started' yields to active sessions", () => {
      const sessions = [makeSession("s1", "running", "2025-01-01T00:00:00Z")];
      const result = computeTaskStatus("not_started", sessions);
      expect(result.status).toBe("working");
    });
  });

  // ── Active sessions ──────────────────────────────────────────────
  describe("active sessions", () => {
    it("returns 'working' for a running session", () => {
      const sessions = [makeSession("s1", "running")];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "working",
        latestSessionId: "s1",
      });
    });

    it("returns 'paused' when any session is idle", () => {
      const sessions = [
        makeSession("s1", "running", "2025-01-01T00:00:00Z"),
        makeSession("s2", "idle", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "paused",
        latestSessionId: "s2",
      });
    });

    it("prefers 'paused' even when running session is newer", () => {
      const sessions = [
        makeSession("s1", "idle", "2025-01-01T00:00:00Z"),
        makeSession("s2", "running", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "paused",
        latestSessionId: "s2",
      });
    });

    it("returns 'working' for a pending session", () => {
      const sessions = [makeSession("s1", "pending")];
      // A "pending" session is active — the task is effectively working
      expect(computeTaskStatus("not_started", sessions).status).toBe("working");
    });
  });

  // ── Terminal sessions ────────────────────────────────────────────
  describe("terminal sessions", () => {
    it("completed session → 'paused'", () => {
      const sessions = [makeSession("s1", "completed")];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "paused",
        latestSessionId: "s1",
      });
    });

    it("failed session → 'failed'", () => {
      const sessions = [makeSession("s1", "failed")];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "failed",
        latestSessionId: "s1",
      });
    });

    it("interrupted session → 'not_started' (retryable)", () => {
      const sessions = [makeSession("s1", "interrupted")];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "not_started",
        latestSessionId: "s1",
      });
    });

    it("uses latest terminal session by startedAt", () => {
      const sessions = [
        makeSession("s1", "failed", "2025-01-01T00:00:00Z"),
        makeSession("s2", "completed", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "paused",
        latestSessionId: "s2",
      });
    });
  });

  // ── Mixed active + terminal sessions ─────────────────────────────
  describe("mixed sessions", () => {
    it("active session takes precedence over older terminal sessions", () => {
      const sessions = [
        makeSession("s1", "completed", "2025-01-01T00:00:00Z"),
        makeSession("s2", "running", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions)).toEqual({
        status: "working",
        latestSessionId: "s2",
      });
    });
  });

  // ── Latest session ID ────────────────────────────────────────────
  describe("latestSessionId", () => {
    it("returns the session with the latest startedAt", () => {
      const sessions = [
        makeSession("s1", "completed", "2025-01-01T00:00:00Z"),
        makeSession("s2", "completed", "2025-01-01T00:02:00Z"),
        makeSession("s3", "completed", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions).latestSessionId).toBe("s2");
    });

    it("breaks ties by ID", () => {
      const sessions = [
        makeSession("a", "completed", "2025-01-01T00:00:00Z"),
        makeSession("b", "completed", "2025-01-01T00:00:00Z"),
      ];
      expect(computeTaskStatus("not_started", sessions).latestSessionId).toBe("b");
    });
  });
});
