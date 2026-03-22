import { describe, it, expect } from "vitest";
import { RUNTIME_MANIFESTS } from "@grackle-ai/common";

describe("RUNTIME_MANIFESTS", () => {
  it("contains entries for all expected runtimes", () => {
    const expectedRuntimes = [
      "claude-code",
      "copilot",
      "codex",
      "goose",
      "codex-acp",
      "copilot-acp",
      "claude-code-acp",
      "genaiscript",
    ];
    for (const name of expectedRuntimes) {
      expect(RUNTIME_MANIFESTS[name], `Missing manifest for runtime: ${name}`).toBeDefined();
    }
  });

  it("does not contain stub runtimes", () => {
    expect(RUNTIME_MANIFESTS["stub"]).toBeUndefined();
    expect(RUNTIME_MANIFESTS["stub-mcp"]).toBeUndefined();
  });

  it("has non-empty packages for every manifest entry", () => {
    for (const [name, manifest] of Object.entries(RUNTIME_MANIFESTS)) {
      const packageCount = Object.keys(manifest.packages).length;
      expect(packageCount, `Runtime "${name}" has no packages`).toBeGreaterThan(0);
    }
  });

  it("has valid semver ranges for all package specs", () => {
    const semverRangePattern = /^\^?\d+\.\d+\.\d+/;
    for (const [name, manifest] of Object.entries(RUNTIME_MANIFESTS)) {
      for (const [pkg, version] of Object.entries(manifest.packages)) {
        expect(
          semverRangePattern.test(version),
          `Invalid version "${version}" for "${pkg}" in runtime "${name}"`,
        ).toBe(true);
      }
    }
  });

  it("only copilot has needsJsonRpcHook set", () => {
    for (const [name, manifest] of Object.entries(RUNTIME_MANIFESTS)) {
      if (name === "copilot") {
        expect(manifest.needsJsonRpcHook).toBe(true);
      } else {
        expect(manifest.needsJsonRpcHook, `Runtime "${name}" should not have needsJsonRpcHook`).toBeFalsy();
      }
    }
  });

  it("ACP runtimes include @agentclientprotocol/sdk", () => {
    for (const name of ["goose", "codex-acp", "copilot-acp", "claude-code-acp"]) {
      const manifest = RUNTIME_MANIFESTS[name]!;
      expect(manifest.packages["@agentclientprotocol/sdk"]).toBeDefined();
    }
  });
});
