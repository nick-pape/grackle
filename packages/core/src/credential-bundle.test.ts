/**
 * Unit tests for credential-bundle.ts — verifying provider token bundle
 * construction, `gh auth token` fallback, Copilot self-sufficiency, and
 * caching behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { powerline } from "@grackle-ai/common";

// ── Mock dependencies before importing module under test ──────────────

const mockExec = vi.fn();
vi.mock("./utils/exec.js", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

const mockGetCredentialProviders = vi.fn();
vi.mock("@grackle-ai/database", () => ({
  credentialProviders: {
    getCredentialProviders: (...args: unknown[]) => mockGetCredentialProviders(...args),
  },
  githubAccountStore: {
    getDefaultGitHubAccount: vi.fn(() => undefined),
    resolveStoredGitHubToken: vi.fn(() => undefined),
  },
}));

// Import AFTER mocks
import {
  buildProviderTokenBundle,
  resolveGitHubTokenFromCli,
  deriveCredentialNeeds,
  findUnsatisfiedNeeds,
  inspectFileCredentialExpiry,
  formatPreflightCredentialError,
  RUNTIME_PROVIDERS,
} from "./credential-bundle.js";
import type {
  ProtectedResourceDescriptor,
  ProviderTokenBundle,
  TokenItem,
} from "./credential-bundle.js";
import { RUNTIME_CATALOG } from "@grackle-ai/common";
import { existsSync, readFileSync } from "node:fs";
import type { CredentialProviderConfig } from "@grackle-ai/database";

// ── Helpers ───────────────────────────────────────────────────────────

/** Default config with all providers off. */
function allOff(): CredentialProviderConfig {
  return { claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" };
}

/** Find a token item in a bundle by envVar name. */
function findByEnvVar(
  bundle: powerline.TokenBundle,
  envVar: string,
): powerline.TokenItem | undefined {
  return bundle.tokens.find((t) => t.envVar === envVar);
}

/** Find a token item in a bundle by filePath. */
function findByFilePath(
  bundle: powerline.TokenBundle,
  filePath: string,
): powerline.TokenItem | undefined {
  return bundle.tokens.find((t) => t.filePath === filePath);
}

/** Count items in a bundle with a given envVar. */
function countByEnvVar(bundle: powerline.TokenBundle, envVar: string): number {
  return bundle.tokens.filter((t) => t.envVar === envVar).length;
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCredentialProviders.mockReturnValue(allOff());
  mockExec.mockRejectedValue(new Error("gh not found")); // default: gh unavailable
  // Reset fs mocks to default state — clearAllMocks only resets call history,
  // not mockReturnValue overrides from previous tests.
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReturnValue("");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── resolveGitHubTokenFromCli() ─────────────────────────────────────

describe("resolveGitHubTokenFromCli()", () => {
  it("returns the token when gh auth token succeeds", async () => {
    mockExec.mockResolvedValue({ stdout: "ghp_abc123", stderr: "" });

    const result = await resolveGitHubTokenFromCli();

    expect(result).toBe("ghp_abc123");
    expect(mockExec).toHaveBeenCalledWith("gh", ["auth", "token"], { timeout: 5_000 });
  });

  it("returns undefined when gh auth token fails (ENOENT)", async () => {
    mockExec.mockRejectedValue(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));

    const result = await resolveGitHubTokenFromCli();

    expect(result).toBeUndefined();
  });

  it("returns undefined when gh auth token returns empty stdout", async () => {
    mockExec.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await resolveGitHubTokenFromCli();

    expect(result).toBeUndefined();
  });

  it("returns undefined when gh auth token times out", async () => {
    mockExec.mockRejectedValue(new Error("Command timed out"));

    const result = await resolveGitHubTokenFromCli();

    expect(result).toBeUndefined();
  });

  it("returns undefined when gh is not authenticated", async () => {
    mockExec.mockRejectedValue(new Error("not logged into any GitHub hosts"));

    const result = await resolveGitHubTokenFromCli();

    expect(result).toBeUndefined();
  });
});

// ─── buildProviderTokenBundle() — GitHub provider ────────────────────

describe("buildProviderTokenBundle() — GitHub provider", () => {
  beforeEach(() => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), github: "on" });
  });

  it("pushes GITHUB_TOKEN from env var", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_from_env");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghp_from_env");
    expect(item!.type).toBe("env_var");
    expect(item!.name).toBe("github-token");
  });

  it("pushes GH_TOKEN from env var", async () => {
    vi.stubEnv("GH_TOKEN", "gho_from_env");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GH_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("gho_from_env");
  });

  it("pushes both GITHUB_TOKEN and GH_TOKEN when both are set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_one");
    vi.stubEnv("GH_TOKEN", "gho_two");

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeDefined();
    expect(findByEnvVar(bundle, "GH_TOKEN")).toBeDefined();
    expect(bundle.tokens).toHaveLength(2);
  });

  it("falls back to gh auth token when no env vars are set", async () => {
    mockExec.mockResolvedValue({ stdout: "ghp_from_cli", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghp_from_cli");
    expect(item!.name).toBe("github-token");
    expect(mockExec).toHaveBeenCalledOnce();
  });

  it("does not call gh auth token when GITHUB_TOKEN env var is set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_from_env");

    await buildProviderTokenBundle();

    expect(mockExec).not.toHaveBeenCalled();
  });

  it("does not call gh auth token when GH_TOKEN env var is set", async () => {
    vi.stubEnv("GH_TOKEN", "gho_from_env");

    await buildProviderTokenBundle();

    expect(mockExec).not.toHaveBeenCalled();
  });

  it("produces empty bundle when gh auth token also fails", async () => {
    mockExec.mockRejectedValue(new Error("gh not found"));

    const bundle = await buildProviderTokenBundle();

    expect(bundle.tokens).toHaveLength(0);
  });

  it("does not push GitHub token when github provider is disabled", async () => {
    mockGetCredentialProviders.mockReturnValue(allOff());
    vi.stubEnv("GITHUB_TOKEN", "ghp_should_not_appear");
    mockExec.mockResolvedValue({ stdout: "ghp_cli_should_not_appear", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeUndefined();
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ─── buildProviderTokenBundle() — Copilot provider ───────────────────

describe("buildProviderTokenBundle() — Copilot provider", () => {
  it("pushes copilot config file when it exists", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{"user":"test"}');

    const bundle = await buildProviderTokenBundle();

    const item = findByFilePath(bundle, "~/.copilot/config.json");
    expect(item).toBeDefined();
    expect(item!.type).toBe("file");
    expect(item!.name).toBe("copilot-config");
  });

  it("pushes COPILOT_GITHUB_TOKEN when set", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "ghu_copilot");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "COPILOT_GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghu_copilot");
  });

  it("does not resolve gh auth token when COPILOT_GITHUB_TOKEN is set", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "ghu_copilot");
    mockExec.mockResolvedValue({ stdout: "ghp_should_not_be_called", stderr: "" });

    await buildProviderTokenBundle();

    expect(mockExec).not.toHaveBeenCalled();
  });

  it("pushes GITHUB_TOKEN from env when copilot enabled but no COPILOT_GITHUB_TOKEN", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.stubEnv("GITHUB_TOKEN", "ghp_for_copilot");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghp_for_copilot");
  });

  it("pushes GH_TOKEN from env when copilot enabled but no COPILOT_GITHUB_TOKEN", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.stubEnv("GH_TOKEN", "gho_for_copilot");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GH_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("gho_for_copilot");
  });

  it("falls back to gh auth token when copilot enabled and no GitHub env vars at all", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    mockExec.mockResolvedValue({ stdout: "ghp_cli_for_copilot", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghp_cli_for_copilot");
  });

  it("produces bundle without GITHUB_TOKEN when gh auth token fails and no env vars", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    mockExec.mockRejectedValue(new Error("gh not found"));

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeUndefined();
    expect(findByEnvVar(bundle, "GH_TOKEN")).toBeUndefined();
    expect(findByEnvVar(bundle, "COPILOT_GITHUB_TOKEN")).toBeUndefined();
  });

  it("pushes COPILOT_CLI_URL and COPILOT_PROVIDER_CONFIG when set", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" });
    vi.stubEnv("COPILOT_CLI_URL", "http://localhost:4321");
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", '{"type":"openai"}');

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "COPILOT_CLI_URL")!.value).toBe("http://localhost:4321");
    expect(findByEnvVar(bundle, "COPILOT_PROVIDER_CONFIG")!.value).toBe('{"type":"openai"}');
  });
});

// ─── Copilot + GitHub provider interaction ───────────────────────────

describe("buildProviderTokenBundle() — Copilot + GitHub interaction", () => {
  it("does not duplicate GITHUB_TOKEN when both copilot and github providers are on", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on", github: "on" });
    vi.stubEnv("GITHUB_TOKEN", "ghp_shared");

    const bundle = await buildProviderTokenBundle();

    // GITHUB_TOKEN should appear exactly once (from the GitHub provider block)
    expect(countByEnvVar(bundle, "GITHUB_TOKEN")).toBe(1);
  });

  it("does not duplicate gh auth token when both copilot and github providers are on", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on", github: "on" });
    mockExec.mockResolvedValue({ stdout: "ghp_from_cli", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    // gh auth token should be called only once (cached) and GITHUB_TOKEN pushed once
    expect(mockExec).toHaveBeenCalledOnce();
    expect(countByEnvVar(bundle, "GITHUB_TOKEN")).toBe(1);
  });

  it("copilot gets GITHUB_TOKEN from cli when github provider is disabled", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" }); // github: "off"
    mockExec.mockResolvedValue({ stdout: "ghp_cli_only", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GITHUB_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("ghp_cli_only");
  });

  it("copilot gets GH_TOKEN from env when github provider is disabled", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" }); // github: "off"
    vi.stubEnv("GH_TOKEN", "gho_env_only");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "GH_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("gho_env_only");
    expect(mockExec).not.toHaveBeenCalled(); // no need for cli fallback
  });
});

// ─── Caching behavior ────────────────────────────────────────────────

describe("buildProviderTokenBundle() — gh auth token caching", () => {
  it("calls gh auth token only once when both github and copilot need it", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on", github: "on" });
    mockExec.mockResolvedValue({ stdout: "ghp_cached", stderr: "" });

    const bundle = await buildProviderTokenBundle();

    // Both providers need the fallback, but gh should only be called once
    expect(mockExec).toHaveBeenCalledOnce();
    // The token should appear exactly once (second block deduplicates)
    expect(countByEnvVar(bundle, "GITHUB_TOKEN")).toBe(1);
  });

  it("caches undefined result so gh is not retried within same call", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on", github: "on" });
    mockExec.mockRejectedValue(new Error("gh not found"));

    const bundle = await buildProviderTokenBundle();

    // gh was called once, failed, and cached — not retried for copilot block
    expect(mockExec).toHaveBeenCalledOnce();
    expect(bundle.tokens).toHaveLength(0);
  });
});

// ─── Runtime scoping ─────────────────────────────────────────────────

describe("buildProviderTokenBundle() — runtime scoping", () => {
  it("returns only copilot + github providers for runtime='copilot'", async () => {
    mockGetCredentialProviders.mockReturnValue({
      claude: "subscription",
      github: "on",
      copilot: "on",
      codex: "on",
      goose: "on",
    });
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");

    const bundle = await buildProviderTokenBundle("copilot");

    // Should have GITHUB_TOKEN (from github block) and not ANTHROPIC_API_KEY or OPENAI_API_KEY
    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeDefined();
    expect(findByEnvVar(bundle, "ANTHROPIC_API_KEY")).toBeUndefined();
    expect(findByEnvVar(bundle, "OPENAI_API_KEY")).toBeUndefined();
  });

  it("returns only claude + github providers for runtime='claude-code'", async () => {
    mockGetCredentialProviders.mockReturnValue({
      claude: "api_key",
      github: "on",
      copilot: "on",
      codex: "on",
      goose: "on",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "ghu_test");

    const bundle = await buildProviderTokenBundle("claude-code");

    expect(findByEnvVar(bundle, "ANTHROPIC_API_KEY")).toBeDefined();
    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeDefined();
    expect(findByEnvVar(bundle, "COPILOT_GITHUB_TOKEN")).toBeUndefined();
  });

  it("returns empty bundle for unknown runtime", async () => {
    mockGetCredentialProviders.mockReturnValue({
      claude: "subscription",
      github: "on",
      copilot: "on",
      codex: "on",
      goose: "on",
    });
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");

    const bundle = await buildProviderTokenBundle("unknown-runtime");

    expect(bundle.tokens).toHaveLength(0);
  });

  it("returns all enabled providers when runtime is omitted", async () => {
    mockGetCredentialProviders.mockReturnValue({
      claude: "api_key",
      github: "on",
      copilot: "off",
      codex: "off",
      goose: "off",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "ANTHROPIC_API_KEY")).toBeDefined();
    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeDefined();
  });

  it("returns empty bundle for stub runtime", async () => {
    mockGetCredentialProviders.mockReturnValue({
      claude: "subscription",
      github: "on",
      copilot: "on",
      codex: "on",
      goose: "on",
    });

    const bundle = await buildProviderTokenBundle("stub");

    expect(bundle.tokens).toHaveLength(0);
  });
});

// ─── Claude provider (unchanged but verify preserved) ────────────────

describe("buildProviderTokenBundle() — Claude provider", () => {
  it("pushes ANTHROPIC_API_KEY when claude=api_key", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "api_key" });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "ANTHROPIC_API_KEY");
    expect(item).toBeDefined();
    expect(item!.value).toBe("sk-ant-test");
  });

  it("pushes credentials file when claude=subscription", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "subscription" });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{"session":"abc"}');

    const bundle = await buildProviderTokenBundle();

    const item = findByFilePath(bundle, "~/.claude/.credentials.json");
    expect(item).toBeDefined();
    expect(item!.type).toBe("file");
  });

  it("does not push credentials file when it is empty", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "subscription" });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("   ");

    const bundle = await buildProviderTokenBundle();

    expect(bundle.tokens).toHaveLength(0);
  });
});

// ─── Codex provider (unchanged but verify preserved) ─────────────────

describe("buildProviderTokenBundle() — Codex provider", () => {
  it("pushes OPENAI_API_KEY when codex=on", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), codex: "on" });
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-test");

    const bundle = await buildProviderTokenBundle();

    const item = findByEnvVar(bundle, "OPENAI_API_KEY");
    expect(item).toBeDefined();
    expect(item!.value).toBe("sk-openai-test");
  });

  it("pushes codex auth file when it exists", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), codex: "on" });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{"token":"xyz"}');

    const bundle = await buildProviderTokenBundle();

    const item = findByFilePath(bundle, "~/.codex/auth.json");
    expect(item).toBeDefined();
    expect(item!.type).toBe("file");
  });
});

// ─── Goose provider (unchanged but verify preserved) ─────────────────

describe("buildProviderTokenBundle() — Goose provider", () => {
  it("pushes goose-related env vars when goose=on", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), goose: "on" });
    vi.stubEnv("GOOSE_PROVIDER", "anthropic");
    vi.stubEnv("GOOSE_MODEL", "claude-3-opus");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-goose");

    const bundle = await buildProviderTokenBundle();

    expect(findByEnvVar(bundle, "GOOSE_PROVIDER")!.value).toBe("anthropic");
    expect(findByEnvVar(bundle, "GOOSE_MODEL")!.value).toBe("claude-3-opus");
    expect(findByEnvVar(bundle, "ANTHROPIC_API_KEY")!.value).toBe("sk-ant-goose");
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

describe("buildProviderTokenBundle() — edge cases", () => {
  it("returns empty bundle when all providers are off", async () => {
    mockGetCredentialProviders.mockReturnValue(allOff());
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");

    const bundle = await buildProviderTokenBundle();

    expect(bundle.tokens).toHaveLength(0);
  });

  it("does not call gh auth token when no provider needs it", async () => {
    mockGetCredentialProviders.mockReturnValue(allOff());

    await buildProviderTokenBundle();

    expect(mockExec).not.toHaveBeenCalled();
  });

  it("handles concurrent calls independently (no cross-call cache leak)", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), github: "on" });
    let callCount = 0;
    mockExec.mockImplementation(async () => {
      callCount++;
      return { stdout: `ghp_call_${callCount}`, stderr: "" };
    });

    // Two independent calls — each should resolve gh auth token independently
    const [bundle1, bundle2] = await Promise.all([
      buildProviderTokenBundle(),
      buildProviderTokenBundle(),
    ]);

    const item1 = findByEnvVar(bundle1, "GITHUB_TOKEN");
    const item2 = findByEnvVar(bundle2, "GITHUB_TOKEN");
    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
    // Each call has its own cache — so gh is called twice (once per call)
    expect(callCount).toBe(2);
  });

  it("GH_TOKEN takes priority in copilot block when both GH_TOKEN and GITHUB_TOKEN exist", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), copilot: "on" }); // github: off
    vi.stubEnv("GH_TOKEN", "gho_priority");
    vi.stubEnv("GITHUB_TOKEN", "ghp_secondary");

    const bundle = await buildProviderTokenBundle();

    // The copilot block checks GH_TOKEN first (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
    const item = findByEnvVar(bundle, "GH_TOKEN");
    expect(item).toBeDefined();
    expect(item!.value).toBe("gho_priority");
    // GITHUB_TOKEN should NOT also be pushed (it's a fallback, not both)
    expect(findByEnvVar(bundle, "GITHUB_TOKEN")).toBeUndefined();
  });
});

// ─── deriveCredentialNeeds() — advertise-needs descriptor (#1288) ─────

describe("deriveCredentialNeeds()", () => {
  /** All providers fully enabled (claude in subscription mode). */
  function allOn(): CredentialProviderConfig {
    return { claude: "subscription", github: "on", copilot: "on", codex: "on", goose: "on" };
  }

  /** Find a descriptor by its provider key. */
  function byProvider(
    needs: ProtectedResourceDescriptor[],
    provider: keyof CredentialProviderConfig,
  ): ProtectedResourceDescriptor | undefined {
    return needs.find((n) => n.provider === provider);
  }

  it("returns Anthropic (subscription→file) + GitHub for claude-code", () => {
    const needs = deriveCredentialNeeds("claude-code", {
      ...allOff(),
      claude: "subscription",
      github: "on",
    });

    expect(needs).toHaveLength(2);
    const claude = byProvider(needs, "claude");
    expect(claude).toMatchObject({
      resource: "https://api.anthropic.com",
      resourceName: "Anthropic API",
      credentialKinds: ["oauth-subscription-file"],
    });
    expect(byProvider(needs, "github")).toMatchObject({
      resource: "https://api.github.com",
      credentialKinds: ["env-api-key"],
    });
  });

  it("reflects claude=api_key as env-api-key kind", () => {
    const needs = deriveCredentialNeeds("claude-code", { ...allOff(), claude: "api_key" });

    expect(byProvider(needs, "claude")).toMatchObject({ credentialKinds: ["env-api-key"] });
  });

  it("omits a provider that is off (claude off → only github)", () => {
    const needs = deriveCredentialNeeds("claude-code", {
      ...allOff(),
      claude: "off",
      github: "on",
    });

    expect(byProvider(needs, "claude")).toBeUndefined();
    expect(byProvider(needs, "github")).toBeDefined();
    expect(needs).toHaveLength(1);
  });

  it("returns [] for a runtime when every mapped provider is off", () => {
    expect(deriveCredentialNeeds("claude-code", allOff())).toEqual([]);
  });

  it("returns Copilot (githubcopilot→file) + GitHub for copilot", () => {
    const needs = deriveCredentialNeeds("copilot", { ...allOff(), copilot: "on", github: "on" });

    expect(byProvider(needs, "copilot")).toMatchObject({
      resource: "https://api.githubcopilot.com",
      resourceName: "GitHub Copilot",
      credentialKinds: ["oauth-subscription-file", "env-api-key"],
    });
    expect(byProvider(needs, "github")).toBeDefined();
  });

  it("advertises codex as satisfiable by an OAuth file OR an env API key", () => {
    const needs = deriveCredentialNeeds("codex", { ...allOff(), codex: "on" });

    expect(byProvider(needs, "codex")).toMatchObject({
      resource: "https://api.openai.com",
      resourceName: "OpenAI",
      credentialKinds: ["oauth-subscription-file", "env-api-key"],
    });
  });

  it("returns Goose descriptor for goose", () => {
    const needs = deriveCredentialNeeds("goose", { ...allOff(), goose: "on" });

    expect(byProvider(needs, "goose")).toMatchObject({ resourceName: "Goose" });
  });

  it("treats ACP variants like their base runtime (claude-code-acp)", () => {
    const needs = deriveCredentialNeeds("claude-code-acp", {
      ...allOff(),
      claude: "subscription",
      github: "on",
    });

    expect(byProvider(needs, "claude")).toBeDefined();
    expect(byProvider(needs, "github")).toBeDefined();
  });

  it("returns [] for stub runtime", () => {
    expect(deriveCredentialNeeds("stub", allOn())).toEqual([]);
  });

  it("returns [] for an unknown runtime (fails safe)", () => {
    expect(deriveCredentialNeeds("totally-unknown", allOn())).toEqual([]);
  });

  it("is pure — reads no fs, env, or credential store", () => {
    deriveCredentialNeeds("claude-code", allOn());

    expect(existsSync).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockGetCredentialProviders).not.toHaveBeenCalled();
  });

  // ── Coherence (Decision R): RUNTIME_PROVIDERS keys ⊆ RUNTIME_CATALOG ──
  it("every RUNTIME_PROVIDERS runtime has a catalog entry", () => {
    for (const runtime of Object.keys(RUNTIME_PROVIDERS)) {
      expect(
        RUNTIME_CATALOG[runtime],
        `Runtime "${runtime}" missing from RUNTIME_CATALOG`,
      ).toBeDefined();
    }
  });
});

// ─── Pre-flight credential validation (#1316) ─────────────────────────

/** Build a base64url-encoded string (mirrors Node's "base64url" Buffer encoding). */
function b64url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

/** Build a syntactically valid 3-segment JWT carrying the given claims (no real signature). */
function makeJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "none" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

/** Build a Claude `~/.claude/.credentials.json` blob. */
function claudeFile(oauth: Record<string, unknown>): string {
  return JSON.stringify({ claudeAiOauth: oauth });
}

/** Build a Codex `~/.codex/auth.json` blob. */
function codexFile(tokens: Record<string, unknown>): string {
  return JSON.stringify({ tokens });
}

/** Construct a minimal need descriptor for the given provider. */
function need(provider: ProtectedResourceDescriptor["provider"]): ProtectedResourceDescriptor {
  return {
    resource: `https://example.test/${provider}`,
    resourceName: provider,
    authorizationServers: [],
    scopesSupported: [],
    credentialKinds: [],
    provider,
  };
}

/** Wrap token items into a {@link ProviderTokenBundle}. */
function bundle(tokens: TokenItem[]): ProviderTokenBundle {
  return { tokens };
}

describe("buildProviderTokenBundle() — provider tagging (#1316)", () => {
  it("tags an ANTHROPIC_API_KEY env token with provider 'claude'", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), claude: "api_key" });
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-test");

    const result = await buildProviderTokenBundle("claude-code");
    const item = result.tokens.find((t) => t.envVar === "ANTHROPIC_API_KEY");

    expect(item?.provider).toBe("claude");
  });

  it("tags a resolved GitHub token with provider 'github'", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), github: "on" });
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");

    const result = await buildProviderTokenBundle("claude-code");
    const item = result.tokens.find((t) => t.envVar === "GITHUB_TOKEN");

    expect(item?.provider).toBe("github");
  });

  it("tags the codex auth file with provider 'codex'", async () => {
    mockGetCredentialProviders.mockReturnValue({ ...allOff(), codex: "on" });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(codexFile({ access_token: "x" }) as never);

    const result = await buildProviderTokenBundle("codex");
    const item = result.tokens.find((t) => t.name === "codex-auth");

    expect(item?.provider).toBe("codex");
  });
});

describe("inspectFileCredentialExpiry()", () => {
  const NOW = 1_000_000_000_000; // fixed clock for determinism

  it("returns 'unknown' for non-file tokens", () => {
    const token: TokenItem = { name: "anthropic-api-key", type: "env_var", value: "k" };
    expect(inspectFileCredentialExpiry(token, NOW)).toBe("unknown");
  });

  it("returns 'unknown' for an unrecognized file token name", () => {
    const token: TokenItem = { name: "copilot-config", type: "file", value: "{}" };
    expect(inspectFileCredentialExpiry(token, NOW)).toBe("unknown");
  });

  describe("claude-credentials", () => {
    function token(value: string): TokenItem {
      return { name: "claude-credentials", type: "file", value };
    }

    it("'valid' when expiresAt is in the future (beyond skew)", () => {
      const value = claudeFile({
        accessToken: "a",
        expiresAt: NOW + 10 * 60_000,
        refreshToken: "r",
      });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("valid");
    });

    it("'expired-unrecoverable' when past expiry with no refresh token", () => {
      const value = claudeFile({ accessToken: "a", expiresAt: NOW - 1 });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("expired-unrecoverable");
    });

    it("'expired-recoverable' when past expiry but a refresh token is present", () => {
      const value = claudeFile({ accessToken: "a", expiresAt: NOW - 1, refreshToken: "r" });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("expired-recoverable");
    });

    it("treats expiry within the skew window as expired", () => {
      const value = claudeFile({ accessToken: "a", expiresAt: NOW + 100 });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("expired-unrecoverable");
    });

    it("fails open to 'unknown' on malformed JSON", () => {
      expect(inspectFileCredentialExpiry(token("not json"), NOW)).toBe("unknown");
    });

    it("fails open to 'unknown' when the shape is unexpected", () => {
      expect(inspectFileCredentialExpiry(token(JSON.stringify({ foo: 1 })), NOW)).toBe("unknown");
    });
  });

  describe("codex-auth", () => {
    function token(value: string): TokenItem {
      return { name: "codex-auth", type: "file", value };
    }

    it("'valid' when the access_token JWT exp is in the future", () => {
      const value = codexFile({
        access_token: makeJwt({ exp: NOW / 1000 + 600 }),
        refresh_token: "r",
      });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("valid");
    });

    it("'expired-unrecoverable' when the JWT exp is past with no refresh token", () => {
      const value = codexFile({ access_token: makeJwt({ exp: NOW / 1000 - 60 }) });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("expired-unrecoverable");
    });

    it("'expired-recoverable' when the JWT exp is past but a refresh token is present", () => {
      const value = codexFile({
        access_token: makeJwt({ exp: NOW / 1000 - 60 }),
        refresh_token: "r",
      });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("expired-recoverable");
    });

    it("fails open to 'unknown' on a malformed (non-JWT) access token", () => {
      const value = codexFile({ access_token: "not-a-jwt" });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("unknown");
    });

    it("fails open to 'unknown' when the JWT payload has no exp claim", () => {
      const value = codexFile({ access_token: makeJwt({ sub: "x" }) });
      expect(inspectFileCredentialExpiry(token(value), NOW)).toBe("unknown");
    });
  });
});

describe("findUnsatisfiedNeeds()", () => {
  const NOW = 1_000_000_000_000;

  it("returns [] when there are no needs", () => {
    expect(findUnsatisfiedNeeds([], bundle([]), NOW)).toEqual([]);
  });

  it("reports a need as 'missing' when no token is tagged for its provider", () => {
    const result = findUnsatisfiedNeeds([need("claude")], bundle([]), NOW);
    expect(result).toEqual([{ need: need("claude"), reason: "missing" }]);
  });

  it("treats a need as satisfied when a token is tagged for its provider", () => {
    const tokens: TokenItem[] = [
      { name: "anthropic-api-key", type: "env_var", value: "k", provider: "claude" },
    ];
    expect(findUnsatisfiedNeeds([need("claude")], bundle(tokens), NOW)).toEqual([]);
  });

  it("ignores tokens tagged for a different provider", () => {
    const tokens: TokenItem[] = [
      { name: "github-token", type: "env_var", value: "k", provider: "github" },
    ];
    const result = findUnsatisfiedNeeds([need("claude")], bundle(tokens), NOW);
    expect(result).toEqual([{ need: need("claude"), reason: "missing" }]);
  });

  it("reports 'expired' for an unrecoverable expired OAuth file", () => {
    const tokens: TokenItem[] = [
      {
        name: "claude-credentials",
        type: "file",
        value: claudeFile({ accessToken: "a", expiresAt: NOW - 1 }),
        provider: "claude",
      },
    ];
    const result = findUnsatisfiedNeeds([need("claude")], bundle(tokens), NOW);
    expect(result).toEqual([{ need: need("claude"), reason: "expired" }]);
  });

  it("does NOT report a recoverable (refreshable) expired OAuth file", () => {
    const tokens: TokenItem[] = [
      {
        name: "claude-credentials",
        type: "file",
        value: claudeFile({ accessToken: "a", expiresAt: NOW - 1, refreshToken: "r" }),
        provider: "claude",
      },
    ];
    expect(findUnsatisfiedNeeds([need("claude")], bundle(tokens), NOW)).toEqual([]);
  });

  it("reports each unmet need across multiple providers", () => {
    const tokens: TokenItem[] = [
      { name: "github-token", type: "env_var", value: "k", provider: "github" },
    ];
    const result = findUnsatisfiedNeeds([need("claude"), need("github")], bundle(tokens), NOW);
    expect(result).toEqual([{ need: need("claude"), reason: "missing" }]);
  });
});

describe("formatPreflightCredentialError()", () => {
  it("names the runtime and uses distinct wording for missing vs expired", () => {
    const msg = formatPreflightCredentialError("claude-code", [
      { need: need("claude"), reason: "missing" },
      { need: need("github"), reason: "expired" },
    ]);

    expect(msg).toContain('"claude-code"');
    expect(msg).toContain("no credential was found");
    expect(msg).toContain("re-login required");
    expect(msg).toContain('provider "claude"');
    expect(msg).toContain('provider "github"');
    expect(msg).toContain("grackle credential-provider set");
  });
});
