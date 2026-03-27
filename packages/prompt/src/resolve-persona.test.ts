/**
 * Unit tests for persona resolution (pure, no database mocks).
 */
import { describe, it, expect } from "vitest";
import type { PersonaResolveInput } from "./resolve-persona.js";
import { resolvePersona } from "./resolve-persona.js";

/** Build a mock persona input with sensible defaults. */
function makePersona(overrides: Partial<PersonaResolveInput> = {}): PersonaResolveInput {
  return {
    id: "persona-1",
    name: "Test Persona",
    runtime: "claude-code",
    model: "sonnet",
    maxTurns: 10,
    systemPrompt: "You are a helpful engineer.",
    toolConfig: "{}",
    mcpServers: "[]",
    type: "agent",
    script: "",
    ...overrides,
  };
}

/** Simple lookup function for tests. */
function lookupFrom(personas: PersonaResolveInput[]): (id: string) => PersonaResolveInput | undefined {
  return (id: string) => personas.find((p) => p.id === id);
}

describe("resolvePersona", () => {
  it("request persona ID takes priority over all others", () => {
    const personas = [
      makePersona({ id: "req-persona" }),
      makePersona({ id: "task-default" }),
    ];

    const result = resolvePersona("req-persona", "task-default", "workspace-default", "app-default", lookupFrom(personas));

    expect(result.personaId).toBe("req-persona");
  });

  it("falls back to task default persona when request persona is empty", () => {
    const personas = [makePersona({ id: "task-default" })];

    const result = resolvePersona("", "task-default", "workspace-default", undefined, lookupFrom(personas));

    expect(result.personaId).toBe("task-default");
  });

  it("falls back to workspace default persona when request and task are empty", () => {
    const personas = [makePersona({ id: "workspace-default" })];

    const result = resolvePersona("", "", "workspace-default", undefined, lookupFrom(personas));

    expect(result.personaId).toBe("workspace-default");
  });

  it("falls back to app default when all explicit IDs are empty", () => {
    const personas = [makePersona({ id: "app-default" })];

    const result = resolvePersona("", "", "", "app-default", lookupFrom(personas));

    expect(result.personaId).toBe("app-default");
  });

  it("throws error when no persona ID found at any level", () => {
    expect(() => resolvePersona("", "", "", "", lookupFrom([]))).toThrow(
      "No persona configured. Set a default persona at the app, workspace, or task level, or specify one explicitly.",
    );
  });

  it("throws error when no persona ID found and app default is undefined", () => {
    expect(() => resolvePersona("", "", "", undefined, lookupFrom([]))).toThrow(
      "No persona configured.",
    );
  });

  it("throws error when persona ID is found but lookup returns undefined", () => {
    expect(() => resolvePersona("missing-persona", undefined, undefined, undefined, lookupFrom([]))).toThrow(
      "Persona not found: missing-persona",
    );
  });

  it("returns correct fields from the resolved persona", () => {
    const persona = makePersona({
      id: "custom",
      runtime: "codex",
      model: "gpt-4.1",
      maxTurns: 5,
      systemPrompt: "Be concise.",
      toolConfig: '{"allowed":["read"]}',
      mcpServers: '[{"url":"http://localhost:8080"}]',
    });

    const result = resolvePersona("custom", undefined, undefined, undefined, lookupFrom([persona]));

    expect(result).toEqual({
      personaId: "custom",
      runtime: "codex",
      model: "gpt-4.1",
      maxTurns: 5,
      systemPrompt: "Be concise.",
      toolConfig: '{"allowed":["read"]}',
      mcpServers: '[{"url":"http://localhost:8080"}]',
      type: "agent",
      script: "",
    });
  });

  it("does not include a persona field (no database row leak)", () => {
    const persona = makePersona({ id: "p1" });

    const result = resolvePersona("p1", undefined, undefined, undefined, lookupFrom([persona]));

    expect(result).not.toHaveProperty("persona");
  });

  it("throws error when persona has no runtime configured", () => {
    const persona = makePersona({ id: "bare", runtime: "" });

    expect(() => resolvePersona("bare", undefined, undefined, undefined, lookupFrom([persona]))).toThrow(
      'Persona "Test Persona" has no runtime configured',
    );
  });

  it("throws error when agent persona has no model configured", () => {
    const persona = makePersona({ id: "bare", runtime: "claude-code", model: "", type: "agent" });

    expect(() => resolvePersona("bare", undefined, undefined, undefined, lookupFrom([persona]))).toThrow(
      'Persona "Test Persona" has no model configured',
    );
  });

  it("script persona resolves OK with empty model", () => {
    const persona = makePersona({
      id: "script-1",
      runtime: "genaiscript",
      model: "",
      type: "script",
      script: 'script({ model: "none" }); $`Hello`;',
    });

    const result = resolvePersona("script-1", undefined, undefined, undefined, lookupFrom([persona]));

    expect(result.personaId).toBe("script-1");
    expect(result.type).toBe("script");
    expect(result.script).toBe('script({ model: "none" }); $`Hello`;');
    expect(result.model).toBe("");
  });

  it("script persona without runtime still fails", () => {
    const persona = makePersona({
      id: "script-no-rt",
      runtime: "",
      type: "script",
      script: 'script({ model: "none" });',
    });

    expect(() => resolvePersona("script-no-rt", undefined, undefined, undefined, lookupFrom([persona]))).toThrow(
      'Persona "Test Persona" has no runtime configured',
    );
  });
});
