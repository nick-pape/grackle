/**
 * Unit tests for the runtime-catalog gRPC handler (AHP RootState.agents).
 * Verifies the static catalog is surfaced and per-runtime `protectedResources`
 * are composed from the credential-provider config via the real (pure)
 * `deriveCredentialNeeds`.
 */
import { describe, it, expect, vi } from "vitest";

// Mock only the credential-provider config read; spread the rest of the real
// database module (against an in-memory DB) to avoid the DB-mock blast radius.
vi.mock("@grackle-ai/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grackle-ai/database")>();
  actual.openDatabase(":memory:");
  actual.initDatabase();
  return {
    ...actual,
    credentialProviders: {
      ...actual.credentialProviders,
      getCredentialProviders: vi.fn(() => ({
        claude: "subscription",
        github: "on",
        copilot: "off",
        codex: "off",
        goose: "off",
      })),
    },
  };
});

import { listRuntimes } from "./runtime-handlers.js";
import { RUNTIME_CATALOG } from "@grackle-ai/common";
import type { grackle } from "@grackle-ai/common";

function find(res: grackle.ListRuntimesResponse, provider: string): grackle.RuntimeInfo | undefined {
  return res.runtimes.find((r) => r.provider === provider);
}

describe("listRuntimes", () => {
  it("returns one RuntimeInfo per catalog entry", async () => {
    const res = await listRuntimes();
    expect(res.runtimes).toHaveLength(Object.keys(RUNTIME_CATALOG).length);
  });

  it("surfaces display metadata and models from the catalog", async () => {
    const res = await listRuntimes();
    const claude = find(res, "claude-code");

    expect(claude?.displayName).toBe("Claude Code");
    expect(claude?.description.length).toBeGreaterThan(0);
    expect(claude?.models.some((m) => m.id === "sonnet")).toBe(true);
  });

  it("composes protectedResources from the credential config (claude subscription + github)", async () => {
    const res = await listRuntimes();
    const claude = find(res, "claude-code");

    const anthropic = claude?.protectedResources.find((p) => p.resource === "https://api.anthropic.com");
    expect(anthropic?.credentialKinds).toEqual(["oauth-subscription-file"]);
    const github = claude?.protectedResources.find((p) => p.resource === "https://api.github.com");
    expect(github?.credentialKinds).toEqual(["env-api-key"]);
  });

  it("omits a disabled provider's resource (copilot off → only github)", async () => {
    const res = await listRuntimes();
    const copilot = find(res, "copilot");

    expect(copilot?.protectedResources.some((p) => p.resource === "https://api.githubcopilot.com")).toBe(false);
    expect(copilot?.protectedResources.some((p) => p.resource === "https://api.github.com")).toBe(true);
  });

  it("advertises no credential needs for the stub runtime", async () => {
    const res = await listRuntimes();
    expect(find(res, "stub")?.protectedResources).toHaveLength(0);
  });
});
