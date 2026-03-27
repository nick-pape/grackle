/**
 * Unit tests for resolveBootstrapRuntime.
 *
 * These tests verify that bootstrap pre-installation reads the app-level
 * default persona's runtime rather than the hardcoded environment column.
 *
 * Originally written using TDD; these tests now serve as a regression and behavior specification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database stores so we can control what they return
vi.mock("@grackle-ai/database", () => ({
  settingsStore: {
    getSetting: vi.fn(),
  },
  personaStore: {
    getPersona: vi.fn(),
  },
}));

// Import after mocks
import { settingsStore, personaStore } from "@grackle-ai/database";
import { resolveBootstrapRuntime } from "./resolve-bootstrap-runtime.js";

/** Minimal environment row shape for testing. */
function makeEnvRow(defaultRuntime: string): { defaultRuntime: string } {
  return { defaultRuntime } as Parameters<typeof resolveBootstrapRuntime>[0];
}

describe("resolveBootstrapRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns persona runtime when default persona is configured", () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("claude-code");
    vi.mocked(personaStore.getPersona).mockReturnValue({
      id: "claude-code",
      runtime: "copilot",
    } as ReturnType<typeof personaStore.getPersona>);

    const result = resolveBootstrapRuntime(makeEnvRow("claude-code"));

    expect(result).toBe("copilot");
    expect(settingsStore.getSetting).toHaveBeenCalledWith("default_persona_id");
    expect(personaStore.getPersona).toHaveBeenCalledWith("claude-code");
  });

  it("falls back to env.defaultRuntime when no persona configured", () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("");

    const result = resolveBootstrapRuntime(makeEnvRow("claude-code"));

    expect(result).toBe("claude-code");
    expect(personaStore.getPersona).not.toHaveBeenCalled();
  });

  it("falls back to env.defaultRuntime when persona has no runtime", () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("some-persona");
    vi.mocked(personaStore.getPersona).mockReturnValue({
      id: "some-persona",
      runtime: "",
    } as ReturnType<typeof personaStore.getPersona>);

    const result = resolveBootstrapRuntime(makeEnvRow("claude-code"));

    expect(result).toBe("claude-code");
  });

  it("falls back to env.defaultRuntime when persona not found", () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("deleted-persona");
    vi.mocked(personaStore.getPersona).mockReturnValue(undefined);

    const result = resolveBootstrapRuntime(makeEnvRow("codex"));

    expect(result).toBe("codex");
  });
});
