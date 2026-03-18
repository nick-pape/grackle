import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PersonaRow } from "./schema.js";

// ── Mock persona-store and settings-store ────────────────────────

vi.mock("./persona-store.js", () => ({
  getPersona: vi.fn(),
}));

vi.mock("./settings-store.js", () => ({
  getSetting: vi.fn(),
}));

// Import modules AFTER mocks are set up
import { resolvePersona } from "./resolve-persona.js";
import * as personaStore from "./persona-store.js";
import * as settingsStore from "./settings-store.js";

/** Build a mock PersonaRow with sensible defaults. */
function makePersonaRow(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: "persona-1",
    name: "Test Persona",
    description: "",
    systemPrompt: "You are a helpful engineer.",
    toolConfig: "{}",
    runtime: "claude-code",
    model: "sonnet",
    maxTurns: 10,
    mcpServers: "[]",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolvePersona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("request persona ID takes priority over all others", () => {
    const persona = makePersonaRow({ id: "req-persona" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);
    vi.mocked(settingsStore.getSetting).mockReturnValue("app-default");

    const result = resolvePersona("req-persona", "task-default", "project-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("req-persona");
    expect(result.personaId).toBe("req-persona");
  });

  it("falls back to task default persona when request persona is empty", () => {
    const persona = makePersonaRow({ id: "task-default" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("", "task-default", "project-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("task-default");
    expect(result.personaId).toBe("task-default");
  });

  it("falls back to project default persona when request and task are empty", () => {
    const persona = makePersonaRow({ id: "project-default" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("", "", "project-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("project-default");
    expect(result.personaId).toBe("project-default");
  });

  it("falls back to app setting when all explicit IDs are empty", () => {
    const persona = makePersonaRow({ id: "app-default" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);
    vi.mocked(settingsStore.getSetting).mockReturnValue("app-default");

    const result = resolvePersona("", "", "");

    expect(settingsStore.getSetting).toHaveBeenCalledWith("default_persona_id");
    expect(personaStore.getPersona).toHaveBeenCalledWith("app-default");
    expect(result.personaId).toBe("app-default");
  });

  it("throws error when no persona ID found at any level", () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue(undefined);

    expect(() => resolvePersona("", "", "")).toThrow(
      "No persona configured. Set a default persona at the app, project, or task level, or specify one explicitly.",
    );
  });

  it("throws error when persona ID is found but persona record does not exist", () => {
    vi.mocked(personaStore.getPersona).mockReturnValue(undefined);

    expect(() => resolvePersona("missing-persona")).toThrow(
      "Persona not found: missing-persona",
    );
  });

  it("returns correct fields from the resolved persona", () => {
    const persona = makePersonaRow({
      id: "custom",
      runtime: "codex",
      model: "gpt-4.1",
      maxTurns: 5,
      systemPrompt: "Be concise.",
      toolConfig: '{"allowed":["read"]}',
      mcpServers: '[{"url":"http://localhost:8080"}]',
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("custom");

    expect(result).toEqual({
      personaId: "custom",
      runtime: "codex",
      model: "gpt-4.1",
      maxTurns: 5,
      systemPrompt: "Be concise.",
      toolConfig: '{"allowed":["read"]}',
      mcpServers: '[{"url":"http://localhost:8080"}]',
      persona,
    });
  });

  it("preserves empty runtime and model from persona row without fallback", () => {
    const persona = makePersonaRow({
      id: "bare",
      runtime: "",
      model: "",
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("bare");

    // No fallback — persona rows should have runtime/model set at creation time
    expect(result.runtime).toBe("");
    expect(result.model).toBe("");
  });
});
