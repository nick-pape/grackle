import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./core-plugin.js", () => ({}));
vi.mock("@grackle-ai/plugin-orchestration", () => ({}));
vi.mock("@grackle-ai/plugin-scheduling", () => ({}));
vi.mock("@grackle-ai/plugin-knowledge", () => ({}));

const mockGetRegisteredPlugins = vi.fn();
vi.mock("@grackle-ai/plugin-sdk", () => ({
  getRegisteredPlugins: (...args: unknown[]) => mockGetRegisteredPlugins(...args),
}));

import { validatePluginRegistrations } from "./plugin-registration.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validatePluginRegistrations", () => {
  it("passes when all expected plugins are registered", () => {
    mockGetRegisteredPlugins.mockReturnValue([
      { name: "core" },
      { name: "orchestration" },
      { name: "scheduling" },
      { name: "knowledge" },
    ]);

    expect(() => validatePluginRegistrations()).not.toThrow();
  });

  it("passes when extra plugins are registered beyond expected", () => {
    mockGetRegisteredPlugins.mockReturnValue([
      { name: "core" },
      { name: "orchestration" },
      { name: "scheduling" },
      { name: "knowledge" },
      { name: "custom-plugin" },
    ]);

    expect(() => validatePluginRegistrations()).not.toThrow();
  });

  it("throws when a plugin is missing", () => {
    mockGetRegisteredPlugins.mockReturnValue([{ name: "core" }, { name: "orchestration" }]);

    expect(() => validatePluginRegistrations()).toThrow(/scheduling.*knowledge.*not registered/i);
  });

  it("throws with descriptive message naming the missing plugins", () => {
    mockGetRegisteredPlugins.mockReturnValue([{ name: "core" }]);

    expect(() => validatePluginRegistrations()).toThrow(/orchestration/);
  });
});
