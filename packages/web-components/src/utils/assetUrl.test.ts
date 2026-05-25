import { describe, it, expect, afterEach, vi } from "vitest";
import { assetUrl } from "./assetUrl.js";

describe("assetUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefixes the file with the default base URL", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(assetUrl("icon-192x192.png")).toBe("/icon-192x192.png");
  });

  it("prefixes the file with a sub-path base URL (demo deployment)", () => {
    vi.stubEnv("BASE_URL", "/grackle/demo/");
    expect(assetUrl("icon-192x192.png")).toBe("/grackle/demo/icon-192x192.png");
  });

  it("collapses a leading slash on the file name so the base join never double-slashes", () => {
    vi.stubEnv("BASE_URL", "/grackle/demo/");
    expect(assetUrl("/grackle-logo.png")).toBe("/grackle/demo/grackle-logo.png");
  });
});
