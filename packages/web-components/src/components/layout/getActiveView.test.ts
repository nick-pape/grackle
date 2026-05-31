import { describe, it, expect } from "vitest";
import { getActiveView } from "./AppNav.js";

describe("getActiveView", () => {
  it("maps the Sessions routes to the sessions view", () => {
    // The list, a session detail, and the new-chat (ad-hoc spawn) page all
    // highlight the Sessions tab. This guards the ordering against the older
    // behaviour where /sessions fell through to the chat view.
    expect(getActiveView("/sessions")).toBe("sessions");
    expect(getActiveView("/sessions/abc-123")).toBe("sessions");
    expect(getActiveView("/sessions/new")).toBe("sessions");
  });

  it("keeps the other top-level routes mapped correctly", () => {
    expect(getActiveView("/")).toBe("dashboard");
    expect(getActiveView("/coordination")).toBe("coordination");
    expect(getActiveView("/chat")).toBe("chat");
    expect(getActiveView("/chat/stream-1")).toBe("chat");
    expect(getActiveView("/environments")).toBe("environments");
    expect(getActiveView("/workspaces")).toBe("environments");
    expect(getActiveView("/knowledge")).toBe("knowledge");
    expect(getActiveView("/settings")).toBe("settings");
    expect(getActiveView("/tasks")).toBe("tasks");
    expect(getActiveView("/tasks/task-1")).toBe("tasks");
  });

  it("maps the Personas routes to the personas view", () => {
    // The library list, the new-persona form, and a persona detail page all
    // highlight the top-level Personas tab (#1413).
    expect(getActiveView("/personas")).toBe("personas");
    expect(getActiveView("/personas/new")).toBe("personas");
    expect(getActiveView("/personas/abc-123")).toBe("personas");
  });
});
