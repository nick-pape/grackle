import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SpawnContextInput, SystemPromptContributor } from "@grackle-ai/plugin-sdk";
import {
  setSpawnContextProviders,
  clearSpawnContextProviders,
  hasSpawnContextProviders,
  runSpawnContextProviders,
} from "./spawn-context-registry.js";

vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const input: SpawnContextInput = {
  taskId: "t1",
  title: "Task",
  description: "Desc",
  workspaceId: "w1",
  isOrchestrator: false,
  injectKnowledge: true,
};

function provider(fn: (i: SpawnContextInput) => Promise<string | undefined>): SystemPromptContributor {
  return { contribute: fn };
}

describe("spawn-context-registry", () => {
  beforeEach(() => {
    clearSpawnContextProviders();
  });

  it("hasSpawnContextProviders reflects registration state", () => {
    expect(hasSpawnContextProviders()).toBe(false);
    setSpawnContextProviders([provider(async () => "x")]);
    expect(hasSpawnContextProviders()).toBe(true);
    clearSpawnContextProviders();
    expect(hasSpawnContextProviders()).toBe(false);
  });

  it("returns [] when no providers are registered", async () => {
    expect(await runSpawnContextProviders(input)).toEqual([]);
  });

  it("runs providers in order and drops undefined/empty sections", async () => {
    setSpawnContextProviders([
      provider(async () => "A"),
      provider(async () => undefined),
      provider(async () => ""),
      provider(async () => "B"),
    ]);
    expect(await runSpawnContextProviders(input)).toEqual(["A", "B"]);
  });

  it("isolates a throwing provider — others still contribute", async () => {
    setSpawnContextProviders([
      provider(async () => {
        throw new Error("boom");
      }),
      provider(async () => "ok"),
    ]);
    expect(await runSpawnContextProviders(input)).toEqual(["ok"]);
  });

  it("isolates a provider that throws SYNCHRONOUSLY (never rejects)", async () => {
    setSpawnContextProviders([
      // contribute throws before returning a promise — must not reject Promise.all.
      { contribute: (): Promise<string | undefined> => { throw new Error("sync boom"); } },
      provider(async () => "ok"),
    ]);
    await expect(runSpawnContextProviders(input)).resolves.toEqual(["ok"]);
  });

  it("skips a provider that exceeds the timeout", async () => {
    setSpawnContextProviders([
      provider(() => new Promise((resolve) => setTimeout(() => resolve("late"), 1000))),
      provider(async () => "fast"),
    ]);
    expect(await runSpawnContextProviders(input, { timeoutMs: 30 })).toEqual(["fast"]);
  });
});
