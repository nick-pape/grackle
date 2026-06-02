/**
 * Unit tests for the unified spawn-config cascade (#1427).
 *
 * Covers per-field precedence, sentinel-to-undefined handling at each
 * adapter, missing-layer behavior, and merge semantics for tool/MCP lists.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveSpawnSpec,
  mergeToolConfig,
  mergeMcpServers,
  personaToLayer,
  workspaceToLayer,
  taskToLayer,
  agentToLayer,
  spawnRequestToLayer,
  hostDefaults,
  type SpawnConfigLayer,
  type ResolveSpawnSpecInput,
} from "./resolve-spawn-spec.js";

/** Build a minimal valid input — host + persona always present. */
function baseInput(overrides: Partial<ResolveSpawnSpecInput> = {}): ResolveSpawnSpecInput {
  return {
    host: { workingDirectory: "/host" },
    persona: { runtime: "claude-code", model: "sonnet", maxTurns: 50 },
    ...overrides,
  };
}

describe("resolveSpawnSpec — scalar precedence", () => {
  it("returns persona+host defaults when no other layer contributes", () => {
    const spec = resolveSpawnSpec(baseInput());
    expect(spec.runtime).toBe("claude-code");
    expect(spec.model).toBe("sonnet");
    expect(spec.maxTurns).toBe(50);
    expect(spec.workingDirectory).toBe("/host");
    expect(spec.useWorktrees).toBeUndefined();
  });

  it("workspace overrides persona for workingDirectory", () => {
    const spec = resolveSpawnSpec(baseInput({ workspace: { workingDirectory: "/workspace-wd" } }));
    expect(spec.workingDirectory).toBe("/workspace-wd");
  });

  it("task overrides workspace overrides persona overrides host", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host", runtime: "host-runtime" },
      persona: { runtime: "claude-code", model: "sonnet", workingDirectory: "/persona-wd" },
      workspace: { workingDirectory: "/workspace-wd" },
      task: { workingDirectory: "/task-wd" },
    });
    expect(spec.workingDirectory).toBe("/task-wd");
    expect(spec.runtime).toBe("claude-code"); // persona beats host
  });

  it("agent slots between workspace and task in precedence", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host" },
      persona: { runtime: "claude-code", model: "sonnet", workingDirectory: "/persona-wd" },
      workspace: { workingDirectory: "/workspace-wd" },
      agent: { workingDirectory: "/agent-wd" },
      // No task contribution: agent wins over workspace.
    });
    expect(spec.workingDirectory).toBe("/agent-wd");
  });

  it("task overrides agent", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host" },
      persona: { runtime: "claude-code", model: "sonnet" },
      agent: { workingDirectory: "/agent-wd" },
      task: { workingDirectory: "/task-wd" },
    });
    expect(spec.workingDirectory).toBe("/task-wd");
  });

  it("spawnOverride beats every other layer", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host", runtime: "host-rt" },
      persona: { runtime: "persona-rt", model: "persona-model" },
      workspace: { workingDirectory: "/ws", useWorktrees: true },
      task: { workingDirectory: "/task", maxTurns: 10 },
      spawnOverride: {
        runtime: "override-rt",
        model: "override-model",
        workingDirectory: "/override-wd",
        maxTurns: 99,
        useWorktrees: false,
      },
    });
    expect(spec.runtime).toBe("override-rt");
    expect(spec.model).toBe("override-model");
    expect(spec.workingDirectory).toBe("/override-wd");
    expect(spec.maxTurns).toBe(99);
    expect(spec.useWorktrees).toBe(false);
  });
});

describe("resolveSpawnSpec — useWorktrees handling", () => {
  it("respects a false workspace value (false is a real contribution, not unset)", () => {
    const spec = resolveSpawnSpec(baseInput({ workspace: { useWorktrees: false } }));
    expect(spec.useWorktrees).toBe(false);
  });

  it("respects a true workspace value", () => {
    const spec = resolveSpawnSpec(baseInput({ workspace: { useWorktrees: true } }));
    expect(spec.useWorktrees).toBe(true);
  });

  it("spawn override of false beats workspace true", () => {
    const spec = resolveSpawnSpec(
      baseInput({
        workspace: { useWorktrees: true },
        spawnOverride: { useWorktrees: false },
      }),
    );
    expect(spec.useWorktrees).toBe(false);
  });

  it("returns undefined when no layer expresses an opinion", () => {
    const spec = resolveSpawnSpec(baseInput());
    expect(spec.useWorktrees).toBeUndefined();
  });
});

describe("resolveSpawnSpec — missing optional layers", () => {
  it("works with only host + persona (degenerate spawnAgent path)", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host" },
      persona: { runtime: "claude-code", model: "sonnet", maxTurns: 42 },
    });
    expect(spec.runtime).toBe("claude-code");
    expect(spec.maxTurns).toBe(42);
    expect(spec.workingDirectory).toBe("/host");
  });

  it("works with no spawnOverride layer (task-spawn flow)", () => {
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/host" },
      persona: { runtime: "claude-code", model: "sonnet" },
      workspace: { workingDirectory: "/ws", useWorktrees: true },
      task: {},
    });
    expect(spec.workingDirectory).toBe("/ws");
    expect(spec.useWorktrees).toBe(true);
  });

  it("agent layer absent does not contribute spurious values", () => {
    const spec = resolveSpawnSpec(baseInput({ workspace: { workingDirectory: "/ws" } }));
    expect(spec.workingDirectory).toBe("/ws");
  });
});

describe("mergeToolConfig", () => {
  it("returns empty when no layer contributes", () => {
    const merged = mergeToolConfig([{}, {}]);
    expect(merged).toEqual({ allowedTools: [], disallowedTools: [] });
  });

  it("is identity for a single contributing layer (persona-only behavior)", () => {
    const merged = mergeToolConfig([
      { toolConfig: { allowedTools: ["read", "write"], disallowedTools: ["exec"] } },
    ]);
    expect(merged.allowedTools).toEqual(["read", "write"]);
    expect(merged.disallowedTools).toEqual(["exec"]);
  });

  it("unions allowedTools across layers (low → high)", () => {
    const merged = mergeToolConfig([
      { toolConfig: { allowedTools: ["read"], disallowedTools: [] } },
      { toolConfig: { allowedTools: ["write"], disallowedTools: [] } },
    ]);
    expect(merged.allowedTools.sort()).toEqual(["read", "write"]);
  });

  it("unions disallowedTools across layers — deny wins on conflict", () => {
    const merged = mergeToolConfig([
      { toolConfig: { allowedTools: ["exec"], disallowedTools: [] } },
      { toolConfig: { allowedTools: [], disallowedTools: ["exec"] } },
    ]);
    expect(merged.allowedTools).toEqual(["exec"]);
    expect(merged.disallowedTools).toEqual(["exec"]);
  });

  it("skips layers with no toolConfig contribution", () => {
    const merged = mergeToolConfig([
      {},
      { toolConfig: { allowedTools: ["read"], disallowedTools: [] } },
      {},
    ]);
    expect(merged.allowedTools).toEqual(["read"]);
  });
});

describe("mergeMcpServers", () => {
  it("returns empty when no layer contributes", () => {
    expect(mergeMcpServers([{}])).toEqual([]);
  });

  it("is identity for a single contributing layer (persona-only behavior)", () => {
    const merged = mergeMcpServers([
      {
        mcpServers: [{ name: "github", command: "gh-mcp", args: ["--token", "abc"], tools: [] }],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("github");
    expect(merged[0].args).toEqual(["--token", "abc"]);
  });

  it("appends new server names from higher layers", () => {
    const merged = mergeMcpServers([
      { mcpServers: [{ name: "github", command: "gh", args: [], tools: [] }] },
      { mcpServers: [{ name: "linear", command: "ln", args: [], tools: [] }] },
    ]);
    const names = merged.map((s) => s.name).sort();
    expect(names).toEqual(["github", "linear"]);
  });

  it("higher-precedence layer replaces same-name server wholesale", () => {
    const merged = mergeMcpServers([
      {
        mcpServers: [{ name: "github", command: "gh", args: ["--token", "persona"], tools: ["a"] }],
      },
      {
        mcpServers: [
          { name: "github", command: "gh", args: ["--token", "workspace"], tools: ["b"] },
        ],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].args).toEqual(["--token", "workspace"]);
    expect(merged[0].tools).toEqual(["b"]); // not merged with persona's tools
  });
});

describe("personaToLayer — sentinel handling", () => {
  it("treats empty strings as unset (runtime, model)", () => {
    const layer = personaToLayer({
      runtime: "",
      model: "",
      maxTurns: 0,
      toolConfig: "",
      mcpServers: "",
    });
    expect(layer.runtime).toBeUndefined();
    expect(layer.model).toBeUndefined();
    expect(layer.maxTurns).toBeUndefined();
    expect(layer.toolConfig).toBeUndefined();
    expect(layer.mcpServers).toBeUndefined();
  });

  it("treats 0 maxTurns as unset", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 0,
      toolConfig: "{}",
      mcpServers: "[]",
    });
    expect(layer.maxTurns).toBeUndefined();
  });

  it("parses non-empty toolConfig JSON", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 100,
      toolConfig: JSON.stringify({ allowedTools: ["read"], disallowedTools: ["exec"] }),
      mcpServers: "[]",
    });
    expect(layer.toolConfig).toEqual({ allowedTools: ["read"], disallowedTools: ["exec"] });
    expect(layer.maxTurns).toBe(100);
  });

  it("treats `{}` toolConfig as unset (empty arrays)", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 50,
      toolConfig: "{}",
      mcpServers: "[]",
    });
    expect(layer.toolConfig).toBeUndefined();
  });

  it("ignores malformed toolConfig JSON without throwing", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 50,
      toolConfig: "{not json}",
      mcpServers: "[]",
    });
    expect(layer.toolConfig).toBeUndefined();
  });

  it("parses non-empty mcpServers JSON", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 50,
      toolConfig: "{}",
      mcpServers: JSON.stringify([{ name: "github", command: "gh", args: ["--x"], tools: [] }]),
    });
    expect(layer.mcpServers).toHaveLength(1);
    expect(layer.mcpServers?.[0].name).toBe("github");
  });

  it("skips mcp entries with no name", () => {
    const layer = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 50,
      toolConfig: "{}",
      mcpServers: JSON.stringify([
        { name: "", command: "x" },
        { name: "ok", command: "y" },
      ]),
    });
    expect(layer.mcpServers).toHaveLength(1);
    expect(layer.mcpServers?.[0].name).toBe("ok");
  });
});

describe("workspaceToLayer", () => {
  it("treats empty workingDirectory as unset", () => {
    const layer = workspaceToLayer({ useWorktrees: true, workingDirectory: "" });
    expect(layer.workingDirectory).toBeUndefined();
  });

  it("propagates a non-empty workingDirectory", () => {
    const layer = workspaceToLayer({ useWorktrees: false, workingDirectory: "/repo" });
    expect(layer.workingDirectory).toBe("/repo");
  });

  it("propagates useWorktrees=false as a real contribution", () => {
    const layer = workspaceToLayer({ useWorktrees: false, workingDirectory: "" });
    expect(layer.useWorktrees).toBe(false);
  });
});

describe("taskToLayer / agentToLayer", () => {
  it("return empty contributions (no per-task/per-agent config yet)", () => {
    expect(taskToLayer({})).toEqual({});
    expect(agentToLayer({})).toEqual({});
  });
});

describe("spawnRequestToLayer", () => {
  it("treats empty provider/modelId/configMaxTurns/configWorkingDirectory as unset", () => {
    const layer = spawnRequestToLayer({
      provider: "",
      modelId: "",
      configMaxTurns: 0,
      configWorkingDirectory: "",
      configUseWorktrees: undefined,
    });
    expect(layer.runtime).toBeUndefined();
    expect(layer.model).toBeUndefined();
    expect(layer.maxTurns).toBeUndefined();
    expect(layer.workingDirectory).toBeUndefined();
    expect(layer.useWorktrees).toBeUndefined();
  });

  it("propagates non-empty overrides", () => {
    const layer = spawnRequestToLayer({
      provider: "copilot",
      modelId: "opus",
      configMaxTurns: 25,
      configWorkingDirectory: "/explicit",
      configUseWorktrees: false,
    });
    expect(layer.runtime).toBe("copilot");
    expect(layer.model).toBe("opus");
    expect(layer.maxTurns).toBe(25);
    expect(layer.workingDirectory).toBe("/explicit");
    expect(layer.useWorktrees).toBe(false);
  });

  it("trims whitespace-only workingDirectory to unset", () => {
    const layer = spawnRequestToLayer({ configWorkingDirectory: "   " });
    expect(layer.workingDirectory).toBeUndefined();
  });

  it("undefined source fields produce undefined contributions", () => {
    const layer = spawnRequestToLayer({});
    expect(layer).toEqual({});
  });
});

describe("hostDefaults", () => {
  const original = {
    wd: process.env.GRACKLE_WORKING_DIRECTORY,
    base: process.env.GRACKLE_WORKTREE_BASE,
  };

  beforeEach(() => {
    delete process.env.GRACKLE_WORKING_DIRECTORY;
    delete process.env.GRACKLE_WORKTREE_BASE;
  });

  afterEach(() => {
    if (original.wd === undefined) {
      delete process.env.GRACKLE_WORKING_DIRECTORY;
    } else {
      process.env.GRACKLE_WORKING_DIRECTORY = original.wd;
    }
    if (original.base === undefined) {
      delete process.env.GRACKLE_WORKTREE_BASE;
    } else {
      process.env.GRACKLE_WORKTREE_BASE = original.base;
    }
  });

  it("falls back to /workspace when no env var is set", () => {
    expect(hostDefaults().workingDirectory).toBe("/workspace");
  });

  it("prefers GRACKLE_WORKING_DIRECTORY when set", () => {
    process.env.GRACKLE_WORKING_DIRECTORY = "/custom";
    expect(hostDefaults().workingDirectory).toBe("/custom");
  });

  it("falls through to GRACKLE_WORKTREE_BASE when WORKING_DIRECTORY is unset", () => {
    process.env.GRACKLE_WORKTREE_BASE = "/base";
    expect(hostDefaults().workingDirectory).toBe("/base");
  });

  it("does not contribute a useWorktrees default (call sites apply their own)", () => {
    expect(hostDefaults().useWorktrees).toBeUndefined();
  });
});

describe("end-to-end — adapter + resolver against realistic shapes", () => {
  it("startTask flow: workspace + task + persona compose to expected spec", () => {
    const persona = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 50,
      toolConfig: JSON.stringify({ allowedTools: ["read"], disallowedTools: [] }),
      mcpServers: JSON.stringify([
        { name: "github", command: "gh", args: ["--persona"], tools: [] },
      ]),
    });
    const workspace = workspaceToLayer({ useWorktrees: true, workingDirectory: "/repo" });
    const task = taskToLayer({});
    const spawnOverride: SpawnConfigLayer = {}; // startTask has no per-spawn scalar override
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/workspace" },
      persona,
      workspace,
      task,
      spawnOverride,
    });
    expect(spec.runtime).toBe("claude-code");
    expect(spec.model).toBe("sonnet");
    expect(spec.maxTurns).toBe(50);
    expect(spec.workingDirectory).toBe("/repo");
    expect(spec.useWorktrees).toBe(true);
    expect(spec.mcpServers).toHaveLength(1);
    expect(spec.mcpServers[0].name).toBe("github");
    expect(spec.toolConfig.allowedTools).toEqual(["read"]);
  });

  it("spawnAgent flow: explicit provider+model+maxTurns override persona", () => {
    const persona = personaToLayer({
      runtime: "claude-code",
      model: "sonnet",
      maxTurns: 100,
      toolConfig: "{}",
      mcpServers: "[]",
    });
    const spawnOverride = spawnRequestToLayer({
      provider: "copilot",
      modelId: "opus",
      configMaxTurns: 25,
    });
    const spec = resolveSpawnSpec({
      host: { workingDirectory: "/workspace" },
      persona,
      spawnOverride,
    });
    expect(spec.runtime).toBe("copilot");
    expect(spec.model).toBe("opus");
    expect(spec.maxTurns).toBe(25);
  });
});
