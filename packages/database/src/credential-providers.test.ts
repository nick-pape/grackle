/**
 * Unit tests for credential provider configuration persistence.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getCredentialProviders,
  setCredentialProviders,
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
});
