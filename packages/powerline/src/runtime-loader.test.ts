import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { AgentRuntime } from "@grackle-ai/runtime-sdk";
import type { RuntimeCatalogEntry } from "@grackle-ai/common";

class FakeSdkRuntime implements AgentRuntime {
  public name: string = "fake-sdk";
  public spawn = vi.fn();
  public resume = vi.fn();
}

class FakeAcpRuntime implements AgentRuntime {
  public name: string;
  public spawn = vi.fn();
  public resume = vi.fn();
  public constructor(config: { name: string; command: string; args: string[] }) {
    this.name = config.name;
  }
}

const mockRegisterRuntime = vi.fn();
const mockListRuntimes = vi.fn<() => string[]>().mockReturnValue([]);

vi.mock("./runtime-registry.js", () => ({
  registerRuntime: (...args: unknown[]) => mockRegisterRuntime(...args),
  listRuntimes: () => mockListRuntimes(),
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

let mockCatalog: Record<string, RuntimeCatalogEntry> = {};

vi.mock("@grackle-ai/common", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    get RUNTIME_CATALOG() {
      return mockCatalog;
    },
  };
});

vi.mock("@grackle-ai/runtime-claude-code", () => ({
  ClaudeCodeRuntime: FakeSdkRuntime,
}));

vi.mock("@grackle-ai/runtime-acp", () => ({
  AcpRuntime: FakeAcpRuntime,
}));

// Must import AFTER vi.mock declarations
const { loadRuntimesFromCatalog } = await import("./runtime-loader.js");
const { logger } = await import("./logger.js");

describe("loadRuntimesFromCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalog = {};
    mockListRuntimes.mockReturnValue([]);
  });

  it("registers an SDK runtime from catalog", async () => {
    mockCatalog = {
      "claude-code": {
        displayName: "Claude Code",
        description: "test",
        models: [],
        factory: {
          type: "sdk",
          package: "@grackle-ai/runtime-claude-code",
          exportName: "ClaudeCodeRuntime",
        },
      },
    };
    mockListRuntimes.mockReturnValue(["claude-code"]);

    await loadRuntimesFromCatalog();

    expect(mockRegisterRuntime).toHaveBeenCalledTimes(1);
    const registered = mockRegisterRuntime.mock.calls[0]![0] as AgentRuntime;
    expect(registered).toBeInstanceOf(FakeSdkRuntime);
  });

  it("registers an ACP runtime from catalog with injected name", async () => {
    mockCatalog = {
      goose: {
        displayName: "Goose",
        description: "test",
        models: [],
        factory: {
          type: "acp",
          config: { command: "goose", args: ["acp"] },
        },
      },
    };
    mockListRuntimes.mockReturnValue(["goose"]);

    await loadRuntimesFromCatalog();

    expect(mockRegisterRuntime).toHaveBeenCalledTimes(1);
    const registered = mockRegisterRuntime.mock.calls[0]![0] as FakeAcpRuntime;
    expect(registered).toBeInstanceOf(FakeAcpRuntime);
    expect(registered.name).toBe("goose");
  });

  it("skips entries without a factory descriptor", async () => {
    mockCatalog = {
      stub: {
        displayName: "Stub",
        description: "test",
        models: [],
      },
    };

    await loadRuntimesFromCatalog();

    expect(mockRegisterRuntime).not.toHaveBeenCalled();
  });

  it("skips entries excluded by filter", async () => {
    mockCatalog = {
      "claude-code": {
        displayName: "Claude Code",
        description: "test",
        models: [],
        factory: {
          type: "sdk",
          package: "@grackle-ai/runtime-claude-code",
          exportName: "ClaudeCodeRuntime",
        },
      },
    };

    await loadRuntimesFromCatalog((name) => name !== "claude-code");

    expect(mockRegisterRuntime).not.toHaveBeenCalled();
  });

  it("continues loading when one runtime fails", async () => {
    mockCatalog = {
      "bad-runtime": {
        displayName: "Bad",
        description: "test",
        models: [],
        factory: {
          type: "sdk",
          package: "@grackle-ai/runtime-claude-code",
          exportName: "NonexistentExport",
        },
      },
      goose: {
        displayName: "Goose",
        description: "test",
        models: [],
        factory: {
          type: "acp",
          config: { command: "goose", args: ["acp"] },
        },
      },
    };
    mockListRuntimes.mockReturnValue(["goose"]);

    await loadRuntimesFromCatalog();

    expect(logger.error as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "bad-runtime" }),
      expect.stringContaining("Failed to load runtime"),
      "bad-runtime",
    );
    expect(mockRegisterRuntime).toHaveBeenCalledTimes(1);
    const registered = mockRegisterRuntime.mock.calls[0]![0] as AgentRuntime;
    expect(registered.name).toBe("goose");
  });

  it("logs a summary after loading", async () => {
    mockCatalog = {};
    mockListRuntimes.mockReturnValue(["a", "b"]);

    await loadRuntimesFromCatalog();

    expect(logger.info as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, runtimes: ["a", "b"] }),
      expect.stringContaining("Loaded"),
      2,
    );
  });

  it("loads only filtered runtimes when filter is provided", async () => {
    mockCatalog = {
      "claude-code": {
        displayName: "Claude Code",
        description: "test",
        models: [],
        factory: {
          type: "sdk",
          package: "@grackle-ai/runtime-claude-code",
          exportName: "ClaudeCodeRuntime",
        },
      },
      goose: {
        displayName: "Goose",
        description: "test",
        models: [],
        factory: {
          type: "acp",
          config: { command: "goose", args: ["acp"] },
        },
      },
    };
    mockListRuntimes.mockReturnValue(["goose"]);

    await loadRuntimesFromCatalog((name) => name === "goose");

    expect(mockRegisterRuntime).toHaveBeenCalledTimes(1);
    const registered = mockRegisterRuntime.mock.calls[0]![0] as AgentRuntime;
    expect(registered.name).toBe("goose");
  });
});
