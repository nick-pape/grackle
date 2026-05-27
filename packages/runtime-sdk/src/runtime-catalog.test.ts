import { describe, it, expect } from "vitest";
import { RUNTIME_CATALOG } from "@grackle-ai/common";
import type { RuntimeName } from "@grackle-ai/common";

describe("RUNTIME_CATALOG", () => {
  /** Runtimes that ship npm packages (lazily installed). */
  const installableRuntimes = [
    "claude-code",
    "copilot",
    "codex",
    "goose",
    "codex-acp",
    "copilot-acp",
    "claude-code-acp",
    "genaiscript",
  ];

  /** Built-in/test runtimes that need no npm packages. */
  const builtinRuntimes = ["stub", "stub-mcp"];

  it("contains an entry for every catalog runtime", () => {
    for (const name of [...installableRuntimes, ...builtinRuntimes]) {
      expect(RUNTIME_CATALOG[name], `Missing catalog entry for runtime: ${name}`).toBeDefined();
    }
  });

  it("every entry has a non-empty displayName and description", () => {
    for (const [name, entry] of Object.entries(RUNTIME_CATALOG)) {
      expect(entry.displayName.length, `Runtime "${name}" has empty displayName`).toBeGreaterThan(
        0,
      );
      expect(entry.description.length, `Runtime "${name}" has empty description`).toBeGreaterThan(
        0,
      );
      expect(Array.isArray(entry.models), `Runtime "${name}" models is not an array`).toBe(true);
    }
  });

  it("installable runtimes carry an install manifest with packages", () => {
    for (const name of installableRuntimes) {
      const install = RUNTIME_CATALOG[name]!.install;
      expect(install, `Runtime "${name}" missing install manifest`).toBeDefined();
      expect(
        Object.keys(install!.packages).length,
        `Runtime "${name}" has no packages`,
      ).toBeGreaterThan(0);
    }
  });

  it("built-in runtimes have no install manifest", () => {
    for (const name of builtinRuntimes) {
      expect(RUNTIME_CATALOG[name]!.install).toBeUndefined();
    }
  });

  it("has valid semver ranges for all install package specs", () => {
    const semverRangePattern = /^\^?\d+\.\d+\.\d+/;
    for (const [name, entry] of Object.entries(RUNTIME_CATALOG)) {
      if (entry.install === undefined) {
        continue;
      }
      for (const [pkg, version] of Object.entries(entry.install.packages)) {
        expect(
          semverRangePattern.test(version),
          `Invalid version "${version}" for "${pkg}" in runtime "${name}"`,
        ).toBe(true);
      }
    }
  });

  it("only copilot has needsJsonRpcHook set", () => {
    for (const [name, entry] of Object.entries(RUNTIME_CATALOG)) {
      if (name === "copilot") {
        expect(entry.install?.needsJsonRpcHook).toBe(true);
      } else {
        expect(
          entry.install?.needsJsonRpcHook,
          `Runtime "${name}" should not have needsJsonRpcHook`,
        ).toBeFalsy();
      }
    }
  });

  it("ACP runtimes include @agentclientprotocol/sdk", () => {
    for (const name of ["goose", "codex-acp", "copilot-acp", "claude-code-acp"]) {
      expect(RUNTIME_CATALOG[name]!.install!.packages["@agentclientprotocol/sdk"]).toBeDefined();
    }
  });

  it("model entries carry id/name/provider matching the runtime", () => {
    for (const [name, entry] of Object.entries(RUNTIME_CATALOG)) {
      for (const model of entry.models) {
        expect(model.id.length, `Runtime "${name}" has a model with empty id`).toBeGreaterThan(0);
        expect(
          model.name.length,
          `Runtime "${name}" model "${model.id}" has empty name`,
        ).toBeGreaterThan(0);
        expect(model.provider, `Runtime "${name}" model "${model.id}" provider mismatch`).toBe(
          name,
        );
      }
    }
  });

  // ── Coherence (Decision R): the catalog is the canonical runtime list ──
  it("every first-class RuntimeName has a catalog entry", () => {
    const runtimeNames: RuntimeName[] = ["claude-code", "copilot", "codex", "goose", "stub"];
    for (const name of runtimeNames) {
      expect(RUNTIME_CATALOG[name], `RuntimeName "${name}" missing from catalog`).toBeDefined();
    }
  });
});
