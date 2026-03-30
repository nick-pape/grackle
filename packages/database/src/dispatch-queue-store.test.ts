import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

import * as dispatchQueueStore from "./dispatch-queue-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dispatch_queue (
      id                TEXT PRIMARY KEY,
      task_id           TEXT NOT NULL UNIQUE,
      environment_id    TEXT NOT NULL DEFAULT '',
      persona_id        TEXT NOT NULL DEFAULT '',
      notes             TEXT NOT NULL DEFAULT '',
      pipe              TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      enqueued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

describe("dispatch-queue-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS dispatch_queue");
    applySchema();
  });

  describe("enqueue", () => {
    it("inserts a row", () => {
      dispatchQueueStore.enqueue({
        id: "dq-1",
        taskId: "task-1",
        environmentId: "env-1",
        personaId: "persona-1",
        notes: "hello",
      });

      const row = dispatchQueueStore.getByTaskId("task-1");
      expect(row).toBeDefined();
      expect(row!.taskId).toBe("task-1");
      expect(row!.environmentId).toBe("env-1");
      expect(row!.personaId).toBe("persona-1");
      expect(row!.notes).toBe("hello");
    });

    it("is a no-op when the same taskId is enqueued twice", () => {
      dispatchQueueStore.enqueue({
        id: "dq-1",
        taskId: "task-1",
        environmentId: "env-1",
      });
      // Second enqueue with different id but same taskId should not throw
      dispatchQueueStore.enqueue({
        id: "dq-2",
        taskId: "task-1",
        environmentId: "env-2",
      });

      const all = dispatchQueueStore.listPending();
      expect(all).toHaveLength(1);
      // Original entry is preserved
      expect(all[0]!.environmentId).toBe("env-1");
    });
  });

  describe("dequeue", () => {
    it("removes the row for a task", () => {
      dispatchQueueStore.enqueue({ id: "dq-1", taskId: "task-1" });
      expect(dispatchQueueStore.getByTaskId("task-1")).toBeDefined();

      dispatchQueueStore.dequeue("task-1");
      expect(dispatchQueueStore.getByTaskId("task-1")).toBeUndefined();
    });

    it("is a no-op for a non-existent taskId", () => {
      // Should not throw
      dispatchQueueStore.dequeue("non-existent");
    });
  });

  describe("getByTaskId", () => {
    it("returns the row when present", () => {
      dispatchQueueStore.enqueue({ id: "dq-1", taskId: "task-1", personaId: "p-1" });
      const row = dispatchQueueStore.getByTaskId("task-1");
      expect(row).toBeDefined();
      expect(row!.personaId).toBe("p-1");
    });

    it("returns undefined when absent", () => {
      expect(dispatchQueueStore.getByTaskId("missing")).toBeUndefined();
    });
  });

  describe("listPending", () => {
    it("returns entries in FIFO order by enqueuedAt", () => {
      // Insert with explicit timestamps to control ordering
      sqlite.exec(`
        INSERT INTO dispatch_queue (id, task_id, environment_id, enqueued_at)
        VALUES ('dq-1', 'task-a', 'env-1', '2026-01-01T00:00:00.000Z');
      `);
      sqlite.exec(`
        INSERT INTO dispatch_queue (id, task_id, environment_id, enqueued_at)
        VALUES ('dq-2', 'task-b', 'env-1', '2026-01-01T00:00:01.000Z');
      `);
      sqlite.exec(`
        INSERT INTO dispatch_queue (id, task_id, environment_id, enqueued_at)
        VALUES ('dq-3', 'task-c', 'env-1', '2026-01-01T00:00:00.500Z');
      `);

      const pending = dispatchQueueStore.listPending();
      expect(pending).toHaveLength(3);
      expect(pending[0]!.taskId).toBe("task-a");
      expect(pending[1]!.taskId).toBe("task-c");
      expect(pending[2]!.taskId).toBe("task-b");
    });

    it("returns empty array when queue is empty", () => {
      expect(dispatchQueueStore.listPending()).toEqual([]);
    });
  });

  describe("listPendingForEnvironment", () => {
    it("filters by environmentId", () => {
      dispatchQueueStore.enqueue({ id: "dq-1", taskId: "task-1", environmentId: "env-a" });
      dispatchQueueStore.enqueue({ id: "dq-2", taskId: "task-2", environmentId: "env-b" });
      dispatchQueueStore.enqueue({ id: "dq-3", taskId: "task-3", environmentId: "env-a" });

      const envA = dispatchQueueStore.listPendingForEnvironment("env-a");
      expect(envA).toHaveLength(2);
      expect(envA.every((r) => r.environmentId === "env-a")).toBe(true);

      const envB = dispatchQueueStore.listPendingForEnvironment("env-b");
      expect(envB).toHaveLength(1);
      expect(envB[0]!.taskId).toBe("task-2");
    });
  });
});
