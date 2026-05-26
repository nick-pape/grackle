import { describe, it, expect } from "vitest";
import type { grackle } from "@grackle-ai/common";
import { formatRuntimesTable } from "./runtimes.js";

/** Strip ANSI color codes so assertions are robust to chalk styling. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "");
}

/** Build a minimal RuntimeInfo-shaped object for the formatter (reads plain fields only). */
function runtimeInfo(partial: Partial<grackle.RuntimeInfo>): grackle.RuntimeInfo {
  return {
    provider: "",
    displayName: "",
    description: "",
    models: [],
    protectedResources: [],
    ...partial,
  } as unknown as grackle.RuntimeInfo;
}

describe("formatRuntimesTable", () => {
  it("renders provider, name, models, and credential needs", () => {
    const out = stripAnsi(formatRuntimesTable([
      runtimeInfo({
        provider: "claude-code",
        displayName: "Claude Code",
        models: [{ id: "sonnet", name: "Claude Sonnet", provider: "claude-code" } as grackle.ModelInfo],
        protectedResources: [
          { resourceName: "Anthropic API", credentialKinds: ["oauth-subscription-file"] } as grackle.ProtectedResource,
        ],
      }),
    ]));

    expect(out).toContain("claude-code");
    expect(out).toContain("Claude Code");
    expect(out).toContain("sonnet");
    expect(out).toContain("Anthropic API (oauth-subscription-file)");
  });

  it("shows 'none' when a runtime advertises no credential needs", () => {
    const out = stripAnsi(formatRuntimesTable([
      runtimeInfo({ provider: "stub", displayName: "Stub" }),
    ]));

    expect(out).toContain("stub");
    expect(out).toContain("none");
  });
});
