import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateApiKey, verifyApiKey, _resetCachedKeyForTesting } from "./api-key.js";
import { API_KEY_FILENAME } from "@grackle-ai/common";

describe("api-key", () => {
  let tempDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    _resetCachedKeyForTesting();
    tempDir = mkdtempSync(join(tmpdir(), "grackle-api-key-test-"));
    savedEnv = process.env.GRACKLE_API_KEY;
    delete process.env.GRACKLE_API_KEY;
  });

  afterEach(() => {
    _resetCachedKeyForTesting();
    if (savedEnv !== undefined) {
      process.env.GRACKLE_API_KEY = savedEnv;
    } else {
      delete process.env.GRACKLE_API_KEY;
    }
  });

  describe("loadOrCreateApiKey", () => {
    it("generates a key on disk when no file or env var exists", () => {
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toHaveLength(64);
      const onDisk = readFileSync(join(tempDir, API_KEY_FILENAME), "utf8").trim();
      expect(onDisk).toBe(key);
    });

    it("reads an existing key from disk", () => {
      const existingKey = "b".repeat(64);
      writeFileSync(join(tempDir, API_KEY_FILENAME), existingKey + "\n");
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toBe(existingKey);
    });

    it("uses GRACKLE_API_KEY env var when set", () => {
      const envKey = "c".repeat(64);
      process.env.GRACKLE_API_KEY = envKey;
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toBe(envKey);
      expect(existsSync(join(tempDir, API_KEY_FILENAME))).toBe(false);
    });

    it("env var takes precedence over file on disk", () => {
      const diskKey = "d".repeat(64);
      const envKey = "e".repeat(64);
      writeFileSync(join(tempDir, API_KEY_FILENAME), diskKey + "\n");
      process.env.GRACKLE_API_KEY = envKey;
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toBe(envKey);
    });

    it("ignores empty or whitespace-only GRACKLE_API_KEY", () => {
      process.env.GRACKLE_API_KEY = "   ";
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toHaveLength(64);
      expect(existsSync(join(tempDir, API_KEY_FILENAME))).toBe(true);
    });

    it("trims whitespace from GRACKLE_API_KEY", () => {
      const envKey = "f".repeat(64);
      process.env.GRACKLE_API_KEY = `  ${envKey}  `;
      const key = loadOrCreateApiKey(tempDir);
      expect(key).toBe(envKey);
    });

    it("returns cached key on subsequent calls", () => {
      const key1 = loadOrCreateApiKey(tempDir);
      const key2 = loadOrCreateApiKey(tempDir);
      expect(key1).toBe(key2);
    });
  });

  describe("verifyApiKey", () => {
    it("returns true for a matching token", () => {
      const key = loadOrCreateApiKey(tempDir);
      expect(verifyApiKey(key)).toBe(true);
    });

    it("returns false for a non-matching token", () => {
      loadOrCreateApiKey(tempDir);
      expect(verifyApiKey("wrong-key")).toBe(false);
    });

    it("verifies against env-var-supplied key", () => {
      const envKey = "g".repeat(64);
      process.env.GRACKLE_API_KEY = envKey;
      loadOrCreateApiKey(tempDir);
      expect(verifyApiKey(envKey)).toBe(true);
      expect(verifyApiKey("wrong")).toBe(false);
    });
  });
});
