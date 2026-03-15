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
    it("returns stored status unchanged when no sessions exist", () => {
      expect(computeTaskStatus("pending", [])).toEqual({
        status: "pending",
        latestSessionId: "",
      });
    });

    it("clamps transient status 'in_progress' to 'pending' when no sessions", () => {
      expect(computeTaskStatus("in_progress", [])).toEqual({
        status: "pending",
        latestSessionId: "",
      });
    });

    it("clamps transient status 'waiting_input' to 'pending' when no sessions", () => {
      expect(computeTaskStatus("waiting_input", [])).toEqual({
        status: "pending",
        latestSessionId: "",
      });
    });

    it("preserves 'failed' with no sessions", () => {
      expect(computeTaskStatus("failed", [])).toEqual({
        status: "failed",
        latestSessionId: "",
      });
    });

    it("preserves 'review' with no sessions", () => {
      expect(computeTaskStatus("review", [])).toEqual({
        status: "review",
        latestSessionId: "",
      });
    });
  });

  // ── Sticky statuses ──────────────────────────────────────────────
  describe("sticky statuses", () => {
    it("'done' is sticky even with active sessions", () => {
      const sessions = [makeSession("s1", "running", "2025-01-01T00:00:00Z")];
      expect(computeTaskStatus("done", sessions)).toEqual({
        status: "done",
        latestSessionId: "s1",
      });
    });

    it("'done' is sticky with no sessions", () => {
      expect(computeTaskStatus("done", [])).toEqual({
        status: "done",
        latestSessionId: "",
      });
    });

    it("'assigned' is NOT sticky — yields to active sessions", () => {
      const sessions = [makeSession("s1", "running", "2025-01-01T00:00:00Z")];
      const result = computeTaskStatus("assigned", sessions);
      expect(result.status).toBe("in_progress");
    });

    it("'assigned' is preserved when no sessions exist", () => {
      expect(computeTaskStatus("assigned", [])).toEqual({
        status: "assigned",
        latestSessionId: "",
      });
    });
  });

  // ── Active sessions ──────────────────────────────────────────────
  describe("active sessions", () => {
    it("returns 'in_progress' for a running session", () => {
      const sessions = [makeSession("s1", "running")];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "in_progress",
        latestSessionId: "s1",
      });
    });

    it("returns 'waiting_input' when any session is waiting", () => {
      const sessions = [
        makeSession("s1", "running", "2025-01-01T00:00:00Z"),
        makeSession("s2", "waiting_input", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "waiting_input",
        latestSessionId: "s2",
      });
    });

    it("prefers 'waiting_input' even when running session is newer", () => {
      const sessions = [
        makeSession("s1", "waiting_input", "2025-01-01T00:00:00Z"),
        makeSession("s2", "running", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "waiting_input",
        latestSessionId: "s2",
      });
    });

    it("returns 'in_progress' for a pending session", () => {
      const sessions = [makeSession("s1", "pending")];
      // A "pending" session is active — the task is effectively in progress
      expect(computeTaskStatus("pending", sessions).status).toBe("in_progress");
    });
  });

  // ── Terminal sessions ────────────────────────────────────────────
  describe("terminal sessions", () => {
    it("completed session → 'review'", () => {
      const sessions = [makeSession("s1", "completed")];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "review",
        latestSessionId: "s1",
      });
    });

    it("failed session → 'failed'", () => {
      const sessions = [makeSession("s1", "failed")];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "failed",
        latestSessionId: "s1",
      });
    });

    it("killed session → 'pending' (retryable)", () => {
      const sessions = [makeSession("s1", "killed")];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "pending",
        latestSessionId: "s1",
      });
    });

    it("uses latest terminal session by startedAt", () => {
      const sessions = [
        makeSession("s1", "failed", "2025-01-01T00:00:00Z"),
        makeSession("s2", "completed", "2025-01-01T00:01:00Z"),
      ];
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "review",
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
      expect(computeTaskStatus("pending", sessions)).toEqual({
        status: "in_progress",
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
      expect(computeTaskStatus("pending", sessions).latestSessionId).toBe("s2");
    });

    it("breaks ties by ID", () => {
      const sessions = [
        makeSession("a", "completed", "2025-01-01T00:00:00Z"),
        makeSession("b", "completed", "2025-01-01T00:00:00Z"),
      ];
      expect(computeTaskStatus("pending", sessions).latestSessionId).toBe("b");
    });
  });
});
