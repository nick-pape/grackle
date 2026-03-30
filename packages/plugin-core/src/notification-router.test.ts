import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

const { mockEmit, mockRouteEscalation, mockDeliverPendingEscalations } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockRouteEscalation: vi.fn(),
  mockDeliverPendingEscalations: vi.fn(),
}));

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: mockEmit,
    routeEscalation: mockRouteEscalation,
    deliverPendingEscalations: mockDeliverPendingEscalations,
  };
});

// Import AFTER mocks
import { escalationStore, settingsStore } from "@grackle-ai/database";
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
    it("delegates to core routeEscalation", async () => {
      const esc = makeEscalation();
      await routeEscalation(esc);

      // routeEscalation in plugin-core is a re-export from core
      expect(mockRouteEscalation).toHaveBeenCalledWith(esc);
    });
  });

  describe("deliverPendingEscalations", () => {
    it("delegates to core deliverPendingEscalations", async () => {
      await deliverPendingEscalations();

      expect(mockDeliverPendingEscalations).toHaveBeenCalledOnce();
    });
  });
});
