import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isDevMode } from "./runtime-installer.js";

describe("isDevMode", () => {
  it("returns true when rush.json exists (monorepo context)", () => {
    // This test runs from within the monorepo, so isDevMode() should return true
    expect(isDevMode()).toBe(true);
  });
});

describe("ensureRuntimeInstalled", () => {
  it("returns empty string in dev mode (no-op)", async () => {
    // Import lazily since the module has top-level side effects
    const { ensureRuntimeInstalled } = await import("./runtime-installer.js");
    const result = await ensureRuntimeInstalled("claude-code");
    expect(result).toBe("");
  });

  it("returns empty string for any known runtime in dev mode", async () => {
    const { ensureRuntimeInstalled } = await import("./runtime-installer.js");
    for (const name of ["copilot", "codex", "codex-acp", "copilot-acp", "claude-code-acp", "genaiscript"]) {
      const result = await ensureRuntimeInstalled(name);
      expect(result).toBe("");
    }
  });

  it("returns empty string for unknown runtimes in dev mode (skips validation)", async () => {
    // In dev mode, ensureRuntimeInstalled is a no-op for all runtimes
    // since Rush already handles package resolution
    const { ensureRuntimeInstalled } = await import("./runtime-installer.js");
    const result = await ensureRuntimeInstalled("nonexistent-runtime");
    expect(result).toBe("");
  });
});

describe("importFromRuntime", () => {
  it("falls back to standard import() in dev mode", async () => {
    const { importFromRuntime } = await import("./runtime-installer.js");
    // In dev mode, importFromRuntime just does import(packageName)
    // Import a known module to verify it works
    const mod = await importFromRuntime<typeof import("node:path")>("claude-code", "node:path");
    expect(typeof mod.join).toBe("function");
  });
});

describe("getRuntimeBinDirectory", () => {
  it("returns PowerLine node_modules/.bin in dev mode", async () => {
    const { getRuntimeBinDirectory } = await import("./runtime-installer.js");
    const binDir = getRuntimeBinDirectory("codex-acp");
    expect(binDir).toContain("node_modules");
    expect(binDir).toContain(".bin");
  });
});
