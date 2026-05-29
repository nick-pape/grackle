import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareIsolatedClaudeConfig } from "./acp.js";

// These tests exercise the real filesystem (no node:fs mock) so the
// symlink/copy fallback and clean-settings behavior are validated end to end.

describe("prepareIsolatedClaudeConfig", () => {
  let root: string;
  let realConfigDir: string;
  let isolatedConfigDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "grackle-acp-isolation-"));
    realConfigDir = join(root, "real-claude");
    isolatedConfigDir = join(root, "isolated-claude");
    mkdirSync(realConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a clean empty settings.json that omits the developer's defaultMode", () => {
    // Developer's personal config carries an interactive-only mode the headless
    // Claude Agent SDK enum rejects (#1366).
    writeFileSync(
      join(realConfigDir, "settings.json"),
      JSON.stringify({ permissions: { defaultMode: "auto" } }),
      "utf8",
    );

    const result = prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir);

    expect(result).toBe(isolatedConfigDir);
    const written = readFileSync(join(isolatedConfigDir, "settings.json"), "utf8");
    expect(written.trim()).toBe("{}");
    expect(written).not.toContain("auto");
  });

  it("creates the isolated dir when it does not exist", () => {
    expect(existsSync(isolatedConfigDir)).toBe(false);
    prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir);
    expect(existsSync(join(isolatedConfigDir, "settings.json"))).toBe(true);
  });

  it("provisions credentials (symlink or copy) with matching content", () => {
    const credentialBody = JSON.stringify({ token: "oauth-secret-123" });
    writeFileSync(join(realConfigDir, ".credentials.json"), credentialBody, "utf8");

    prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir);

    const isolatedCreds = join(isolatedConfigDir, ".credentials.json");
    expect(existsSync(isolatedCreds)).toBe(true);
    expect(readFileSync(isolatedCreds, "utf8")).toBe(credentialBody);
  });

  it("omits credentials when the real config dir has none", () => {
    prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir);
    expect(existsSync(join(isolatedConfigDir, ".credentials.json"))).toBe(false);
    // settings.json is still written so the bridge reads a valid config.
    expect(existsSync(join(isolatedConfigDir, "settings.json"))).toBe(true);
  });

  it("is idempotent across repeated spawns and refreshes credentials", () => {
    writeFileSync(join(realConfigDir, ".credentials.json"), "old", "utf8");
    prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir);

    // A later spawn after a credential rotation re-provisions cleanly.
    writeFileSync(join(realConfigDir, ".credentials.json"), "new", "utf8");
    expect(() => prepareIsolatedClaudeConfig(realConfigDir, isolatedConfigDir)).not.toThrow();

    expect(readFileSync(join(isolatedConfigDir, ".credentials.json"), "utf8")).toBe("new");
  });
});
