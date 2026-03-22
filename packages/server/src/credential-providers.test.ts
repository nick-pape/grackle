/**
 * Unit tests for credential provider configuration and token bundle building.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ── Mock heavy dependencies before importing modules under test ─────

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>().mockReturnValue(false),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>().mockReturnValue(""),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync };
});

import {
  getCredentialProviders,
  setCredentialProviders,
  buildProviderTokenBundle,
  parseCredentialProviderConfig,
} from "./credential-providers.js";
import testDb, { sqlite } from "./test-db.js";

function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

describe("credential-providers", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS settings");
    applySchema();
    vi.clearAllMocks();
  });

  describe("parseCredentialProviderConfig()", () => {
    it("parses valid JSON with all fields", () => {
      const result = parseCredentialProviderConfig(
        JSON.stringify({
          claude: "subscription",
          github: "on",
          copilot: "on",
          codex: "off",
        }),
      );
      expect(result).toEqual({
        claude: "subscription",
        github: "on",
        copilot: "on",
        codex: "off",
        goose: "off",
      });
    });

    it("fills missing fields with defaults", () => {
      const result = parseCredentialProviderConfig(JSON.stringify({ claude: "api_key" }));
      expect(result).toEqual({
        claude: "api_key",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      });
    });

    it("throws on invalid JSON", () => {
      expect(() => parseCredentialProviderConfig("not valid json {{{")).toThrow();
    });

    it("returns defaults for non-object JSON values", () => {
      for (const input of ["null", "42", '"hello"', "true"]) {
        const result = parseCredentialProviderConfig(input);
        expect(result).toEqual({
          claude: "off",
          github: "off",
          copilot: "off",
          codex: "off",
          goose: "off",
        });
      }
    });

    it("falls back to defaults for invalid field values", () => {
      const result = parseCredentialProviderConfig(
        JSON.stringify({
          claude: "invalid",
          github: "maybe",
          copilot: "on",
          codex: "yes",
        }),
      );
      expect(result).toEqual({
        claude: "off",
        github: "off",
        copilot: "on",
        codex: "off",
        goose: "off",
      });
    });

    it("returns defaults for empty object", () => {
      const result = parseCredentialProviderConfig("{}");
      expect(result).toEqual({
        claude: "off",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      });
    });
  });

  describe("getCredentialProviders()", () => {
    it("returns all-off defaults when no setting exists", () => {
      const config = getCredentialProviders(testDb);
      expect(config).toEqual({
        claude: "off",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      });
    });
  });

  describe("setCredentialProviders()", () => {
    it("round-trips configuration correctly", () => {
      const config = {
        claude: "subscription" as const,
        github: "on" as const,
        copilot: "off" as const,
        codex: "on" as const,
        goose: "off" as const,
      };

      setCredentialProviders(config, testDb);
      const result = getCredentialProviders(testDb);

      expect(result).toEqual(config);
    });

    it("upserts on repeated calls", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      }, testDb);
      setCredentialProviders({
        claude: "subscription",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);

      const result = getCredentialProviders(testDb);
      expect(result.claude).toBe("subscription");
      expect(result.github).toBe("on");
    });
  });

  describe("buildProviderTokenBundle()", () => {
    afterEach(() => {
      // Clean up env vars
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      delete process.env.COPILOT_GITHUB_TOKEN;
      delete process.env.COPILOT_CLI_URL;
      delete process.env.COPILOT_CLI_PATH;
      delete process.env.COPILOT_PROVIDER_CONFIG;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOSE_PROVIDER;
      delete process.env.GOOSE_MODEL;
      delete process.env.GOOGLE_API_KEY;
    });

    it("returns empty bundle when all providers are off", () => {
      const bundle = buildProviderTokenBundle(undefined, testDb);
      expect(bundle.tokens).toHaveLength(0);
    });

    it("includes ANTHROPIC_API_KEY when claude is api_key", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test-123";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      expect(bundle.tokens).toHaveLength(1);
      expect(bundle.tokens[0].envVar).toBe("ANTHROPIC_API_KEY");
      expect(bundle.tokens[0].value).toBe("sk-test-123");
      expect(bundle.tokens[0].type).toBe("env_var");
    });

    it("includes credentials file when claude is subscription", () => {
      setCredentialProviders({
        claude: "subscription",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      }, testDb);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"oauth_token":"abc"}');

      const bundle = buildProviderTokenBundle(undefined, testDb);
      expect(bundle.tokens).toHaveLength(1);
      expect(bundle.tokens[0].type).toBe("file");
      expect(bundle.tokens[0].filePath).toBe("~/.claude/.credentials.json");
      expect(bundle.tokens[0].value).toBe('{"oauth_token":"abc"}');
    });

    it("includes GitHub tokens when github is on", () => {
      setCredentialProviders({
        claude: "off",
        github: "on",
        copilot: "off",
        codex: "off",
        goose: "off",
      }, testDb);
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.GH_TOKEN = "gho_test";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      expect(bundle.tokens).toHaveLength(2);
      const envVars = bundle.tokens.map((t) => t.envVar);
      expect(envVars).toContain("GITHUB_TOKEN");
      expect(envVars).toContain("GH_TOKEN");
    });

    it("includes Copilot config file and env vars when copilot is on", () => {
      setCredentialProviders({
        claude: "off",
        github: "off",
        copilot: "on",
        codex: "off",
        goose: "off",
      }, testDb);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"logged_in_users":[]}');
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      const fileTokens = bundle.tokens.filter((t) => t.type === "file");
      const envTokens = bundle.tokens.filter((t) => t.type === "env_var");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0].filePath).toBe("~/.copilot/config.json");
      expect(envTokens.some((t) => t.envVar === "COPILOT_GITHUB_TOKEN")).toBe(true);
    });

    it("includes Codex auth file and env var when codex is on", () => {
      setCredentialProviders({
        claude: "off",
        github: "off",
        copilot: "off",
        codex: "on",
        goose: "off",
      }, testDb);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"auth_mode":"chatgpt"}');
      process.env.OPENAI_API_KEY = "sk-openai-test";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      const fileTokens = bundle.tokens.filter((t) => t.type === "file");
      const envTokens = bundle.tokens.filter((t) => t.type === "env_var");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0].filePath).toBe("~/.codex/auth.json");
      expect(envTokens).toHaveLength(1);
      expect(envTokens[0].envVar).toBe("OPENAI_API_KEY");
      expect(envTokens[0].value).toBe("sk-openai-test");
    });

    it("includes Goose config file and env vars when goose is on", () => {
      setCredentialProviders({
        claude: "off",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "on",
      }, testDb);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("provider: anthropic\nmodel: claude-sonnet-4-20250514");
      process.env.GOOSE_PROVIDER = "anthropic";
      process.env.GOOSE_MODEL = "claude-sonnet-4-20250514";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      const fileTokens = bundle.tokens.filter((t) => t.type === "file");
      const envTokens = bundle.tokens.filter((t) => t.type === "env_var");
      expect(fileTokens).toHaveLength(1);
      const expectedPath = process.platform === "win32"
        ? "%APPDATA%/Block/goose/config/config.yaml"
        : "~/.config/goose/config.yaml";
      expect(fileTokens[0].filePath).toBe(expectedPath);
      expect(envTokens.some((t) => t.envVar === "GOOSE_PROVIDER")).toBe(true);
      expect(envTokens.some((t) => t.envVar === "GOOSE_MODEL")).toBe(true);
    });

    it("skips env vars that are not set in process.env", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "off",
        codex: "off",
        goose: "off",
      }, testDb);
      // Don't set any env vars

      const bundle = buildProviderTokenBundle(undefined, testDb);
      expect(bundle.tokens).toHaveLength(0);
    });
  });

  describe("buildProviderTokenBundle() — runtime scoping", () => {
    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.COPILOT_GITHUB_TOKEN;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOSE_PROVIDER;
      delete process.env.GOOSE_MODEL;
      delete process.env.GOOGLE_API_KEY;
    });

    it("claude-code runtime only includes Claude and GitHub tokens", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      const bundle = buildProviderTokenBundle("claude-code", testDb);
      const envVars = bundle.tokens.map((t) => t.envVar);
      expect(envVars).toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("GITHUB_TOKEN");
      expect(envVars).not.toContain("COPILOT_GITHUB_TOKEN");
      expect(envVars).not.toContain("OPENAI_API_KEY");
    });

    it("copilot runtime only includes Copilot and GitHub tokens", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      const bundle = buildProviderTokenBundle("copilot", testDb);
      const envVars = bundle.tokens.map((t) => t.envVar);
      expect(envVars).not.toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("GITHUB_TOKEN");
      expect(envVars).toContain("COPILOT_GITHUB_TOKEN");
      expect(envVars).not.toContain("OPENAI_API_KEY");
    });

    it("codex runtime only includes Codex and GitHub tokens", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      const bundle = buildProviderTokenBundle("codex", testDb);
      const envVars = bundle.tokens.map((t) => t.envVar);
      expect(envVars).not.toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("GITHUB_TOKEN");
      expect(envVars).not.toContain("COPILOT_GITHUB_TOKEN");
      expect(envVars).toContain("OPENAI_API_KEY");
    });

    it("goose runtime only includes Goose and GitHub tokens", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "on",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";
      process.env.GOOSE_PROVIDER = "anthropic";

      const bundle = buildProviderTokenBundle("goose", testDb);
      const envVars = bundle.tokens.map((t) => t.envVar);
      // Goose provider forwards its own env vars and API keys
      expect(envVars).toContain("GOOSE_PROVIDER");
      expect(envVars).toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("OPENAI_API_KEY");
      // GitHub is in goose's provider list
      expect(envVars).toContain("GITHUB_TOKEN");
      // Copilot should not be included
      expect(envVars).not.toContain("COPILOT_GITHUB_TOKEN");
    });

    it("unrecognized runtime includes no providers (fails safe)", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      // An unknown runtime value (e.g. a typo) must not fall back to all providers.
      const bundle = buildProviderTokenBundle("unknown-runtime-typo", testDb);
      expect(bundle.tokens).toHaveLength(0);
    });

    it("stub runtime includes no providers", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      const bundle = buildProviderTokenBundle("stub", testDb);
      expect(bundle.tokens).toHaveLength(0);
    });

    it("no runtime includes all enabled providers", () => {
      setCredentialProviders({
        claude: "api_key",
        github: "on",
        copilot: "on",
        codex: "on",
        goose: "off",
      }, testDb);
      process.env.ANTHROPIC_API_KEY = "sk-test";
      process.env.GITHUB_TOKEN = "ghp_test";
      process.env.COPILOT_GITHUB_TOKEN = "ghu_test";
      process.env.OPENAI_API_KEY = "sk-openai";

      const bundle = buildProviderTokenBundle(undefined, testDb);
      const envVars = bundle.tokens.map((t) => t.envVar);
      expect(envVars).toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("GITHUB_TOKEN");
      expect(envVars).toContain("COPILOT_GITHUB_TOKEN");
      expect(envVars).toContain("OPENAI_API_KEY");
    });
  });
});
