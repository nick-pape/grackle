import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PersonaRow } from "@grackle-ai/database";

// ── Mock persona-store and settings-store ────────────────────────

vi.mock("@grackle-ai/database", () => ({
  db: {},
  sqlite: undefined,
  openDatabase: vi.fn(),
  initDatabase: vi.fn(),
  schema: {},
  personaStore: {
    getPersona: vi.fn(),
    listPersonas: vi.fn(() => []),
    createPersona: vi.fn(),
    updatePersona: vi.fn(),
    deletePersona: vi.fn(),
    getPersonaByName: vi.fn(),
  },
  settingsStore: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    isAllowedSettingKey: vi.fn(() => true),
    WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  },
  isAllowedSettingKey: vi.fn(() => true),
  WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  findingStore: {
    postFinding: vi.fn(),
    queryFindings: vi.fn(() => []),
  },
  credentialProviders: {
    getCredentialProviders: vi.fn(() => ({ claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" })),
    setCredentialProviders: vi.fn(),
    isValidCredentialProviderConfig: vi.fn(() => true),
    VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
    VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
    VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    parseCredentialProviderConfig: vi.fn(),
  },
  grackleHome: "/tmp/test-grackle",
  safeParseJsonArray: (value: unknown) => { if (!value) return []; try { const p = JSON.parse(value as string); return Array.isArray(p) ? p.filter((i: unknown) => typeof i === "string") : []; } catch { return []; } },
  slugify: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
  encrypt: vi.fn((x: unknown) => x),
  decrypt: vi.fn((x: unknown) => x),
  persistEvent: vi.fn(),
  seedDatabase: vi.fn(),
}));

// Import modules AFTER mocks are set up
import { resolvePersona } from "./resolve-persona.js";
import { personaStore, settingsStore } from "@grackle-ai/database";

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
    type: "agent",
    script: "",
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

    const result = resolvePersona("req-persona", "task-default", "workspace-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("req-persona");
    expect(result.personaId).toBe("req-persona");
  });

  it("falls back to task default persona when request persona is empty", () => {
    const persona = makePersonaRow({ id: "task-default" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("", "task-default", "workspace-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("task-default");
    expect(result.personaId).toBe("task-default");
  });

  it("falls back to workspace default persona when request and task are empty", () => {
    const persona = makePersonaRow({ id: "workspace-default" });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("", "", "workspace-default");

    expect(personaStore.getPersona).toHaveBeenCalledWith("workspace-default");
    expect(result.personaId).toBe("workspace-default");
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
      "No persona configured. Set a default persona at the app, workspace, or task level, or specify one explicitly.",
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
      type: "agent",
      script: "",
      persona,
    });
  });

  it("throws error when persona has no runtime configured", () => {
    const persona = makePersonaRow({
      id: "bare",
      runtime: "",
      model: "sonnet",
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    expect(() => resolvePersona("bare")).toThrow(
      'Persona "Test Persona" has no runtime configured',
    );
  });

  it("throws error when agent persona has no model configured", () => {
    const persona = makePersonaRow({
      id: "bare",
      runtime: "claude-code",
      model: "",
      type: "agent",
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    expect(() => resolvePersona("bare")).toThrow(
      'Persona "Test Persona" has no model configured',
    );
  });

  it("script persona resolves OK with empty model", () => {
    const persona = makePersonaRow({
      id: "script-1",
      runtime: "genaiscript",
      model: "",
      type: "script",
      script: 'script({ model: "none" }); $`Hello`;',
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    const result = resolvePersona("script-1");

    expect(result.personaId).toBe("script-1");
    expect(result.type).toBe("script");
    expect(result.script).toBe('script({ model: "none" }); $`Hello`;');
    expect(result.model).toBe("");
  });

  it("script persona without runtime still fails", () => {
    const persona = makePersonaRow({
      id: "script-no-rt",
      runtime: "",
      model: "",
      type: "script",
      script: 'script({ model: "none" });',
    });
    vi.mocked(personaStore.getPersona).mockReturnValue(persona);

    expect(() => resolvePersona("script-no-rt")).toThrow(
      'Persona "Test Persona" has no runtime configured',
    );
  });
});
