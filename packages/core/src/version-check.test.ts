import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkVersionStatus, clearVersionCache } from "./version-check.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock fs.existsSync for Docker detection
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

import { existsSync } from "node:fs";
const mockExistsSync = vi.mocked(existsSync);

describe("checkVersionStatus", () => {
  beforeEach(() => {
    clearVersionCache();
    mockFetch.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns update available when registry has newer version", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });

    const result = await checkVersionStatus();

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("99.0.0");
    expect(result.currentVersion).toBeTruthy();
  });

  it("returns no update when versions match", async () => {
    // Use the actual current version from the package
    const result1 = await checkVersionStatus();
    const currentVersion = result1.currentVersion;

    clearVersionCache();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: currentVersion }),
    });

    const result = await checkVersionStatus();

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe(currentVersion);
  });

  it("returns updateAvailable=false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await checkVersionStatus();

    expect(result.updateAvailable).toBe(false);
  });

  it("returns updateAvailable=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ENOTFOUND"));

    const result = await checkVersionStatus();

    expect(result.updateAvailable).toBe(false);
  });

  it("returns updateAvailable=false on malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    });

    const result = await checkVersionStatus();

    expect(result.updateAvailable).toBe(false);
  });

  it("caches result within TTL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });

    const result1 = await checkVersionStatus(60_000);
    const result2 = await checkVersionStatus(60_000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  it("re-fetches after TTL expires", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });

    await checkVersionStatus(0); // TTL = 0 → always stale
    await checkVersionStatus(0);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("detects Docker via /.dockerenv", async () => {
    mockExistsSync.mockReturnValue(true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });

    const result = await checkVersionStatus();

    expect(result.isDocker).toBe(true);
  });

  it("reports non-Docker when /.dockerenv is absent", async () => {
    mockExistsSync.mockReturnValue(false);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });

    const result = await checkVersionStatus();

    expect(result.isDocker).toBe(false);
  });
});
