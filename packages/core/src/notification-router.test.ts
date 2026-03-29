import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

// Import AFTER mocks
import { escalationStore, settingsStore } from "@grackle-ai/database";
import { emit } from "./event-bus.js";
import { routeEscalation, deliverPendingEscalations } from "./notification-router.js";
import type { EscalationRow } from "@grackle-ai/database";

/** Create a mock EscalationRow for testing. */
function makeEscalation(overrides: Partial<EscalationRow> = {}): EscalationRow {
  return {
    id: "esc-001",
    workspaceId: "ws1",
    taskId: "task-001",
    title: "Need help",
    message: "What auth method should I use?",
    source: "explicit",
    urgency: "normal",
    status: "pending",
    createdAt: "2026-03-28T12:00:00Z",
    deliveredAt: null,
    acknowledgedAt: null,
    taskUrl: "http://localhost:3000/tasks/task-001",
    ...overrides,
  };
}

describe("notification-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global fetch mock
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  describe("routeEscalation", () => {
    it("emits notification.escalated domain event with escalation payload", async () => {
      const esc = makeEscalation();
      await routeEscalation(esc);

      expect(emit).toHaveBeenCalledWith("notification.escalated", expect.objectContaining({
        escalationId: "esc-001",
        taskId: "task-001",
        title: "Need help",
        message: "What auth method should I use?",
        source: "explicit",
        urgency: "normal",
        taskUrl: "http://localhost:3000/tasks/task-001",
      }));
    });

    it("updates escalation status to delivered", async () => {
      const esc = makeEscalation();
      await routeEscalation(esc);

      expect(escalationStore.updateEscalationStatus).toHaveBeenCalledWith("esc-001", "delivered");
    });

    it("POSTs to webhook URL when webhook_url setting exists", async () => {
      vi.mocked(settingsStore.getSetting).mockReturnValue("https://hooks.example.com/notify");
      const esc = makeEscalation();
      await routeEscalation(esc);

      expect(fetch).toHaveBeenCalledWith(
        "https://hooks.example.com/notify",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("does NOT call fetch when no webhook_url setting exists", async () => {
      vi.mocked(settingsStore.getSetting).mockReturnValue(undefined);
      const esc = makeEscalation();
      await routeEscalation(esc);

      expect(fetch).not.toHaveBeenCalled();
    });

    it("still emits domain event even if webhook fetch throws", async () => {
      vi.mocked(settingsStore.getSetting).mockReturnValue("https://hooks.example.com/notify");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const esc = makeEscalation();
      await routeEscalation(esc);

      expect(emit).toHaveBeenCalledWith("notification.escalated", expect.objectContaining({
        escalationId: "esc-001",
      }));
    });

    it("logs error on webhook failure and does not throw", async () => {
      vi.mocked(settingsStore.getSetting).mockReturnValue("https://hooks.example.com/notify");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));

      const esc = makeEscalation();
      // Should not throw
      await expect(routeEscalation(esc)).resolves.toBeUndefined();
    });

    it("updates status to delivered even if webhook fails", async () => {
      vi.mocked(settingsStore.getSetting).mockReturnValue("https://hooks.example.com/notify");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));

      const esc = makeEscalation();
      await routeEscalation(esc);

      // Domain event always fires, so status is delivered
      expect(escalationStore.updateEscalationStatus).toHaveBeenCalledWith("esc-001", "delivered");
    });
  });

  describe("deliverPendingEscalations", () => {
    it("routes each pending escalation", async () => {
      const esc1 = makeEscalation({ id: "esc-001" });
      const esc2 = makeEscalation({ id: "esc-002", title: "Also stuck" });
      vi.mocked(escalationStore.listPendingEscalations).mockReturnValue([esc1, esc2]);

      await deliverPendingEscalations();

      expect(emit).toHaveBeenCalledTimes(2);
      expect(escalationStore.updateEscalationStatus).toHaveBeenCalledTimes(2);
    });

    it("is a no-op when no pending escalations exist", async () => {
      vi.mocked(escalationStore.listPendingEscalations).mockReturnValue([]);

      await deliverPendingEscalations();

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
