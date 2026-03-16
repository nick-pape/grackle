import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./tool-registry.js";
import type { ToolDefinition } from "./tool-registry.js";
import type { AuthContext } from "./auth-context.js";
import {
  SCOPED_TOOLS,
  resolveToolForAuth,
  listToolsForAuth,
} from "./tool-scoping.js";

// ─── Helpers ────────────────────────────────────────────────

/** Create a minimal tool definition for testing. */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({}),
    rpcMethod: name,
    mutating: false,
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

/** Build a registry with the standard scoped tools plus some extras. */
function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(makeTool("finding_post"));
  registry.register(makeTool("finding_list"));
  registry.register(makeTool("task_create"));
  registry.register(makeTool("env_list"));
  registry.register(makeTool("session_list"));
  return registry;
}

const API_KEY_AUTH: AuthContext = { type: "api-key" };

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "task-1",
  projectId: "proj-1",
  personaId: "",
  taskSessionId: "sess-1",
};

// ─── SCOPED_TOOLS constant ──────────────────────────────────

describe("SCOPED_TOOLS", () => {
  it("contains exactly finding_post, finding_list, task_create", () => {
    expect([...SCOPED_TOOLS].sort()).toEqual(["finding_list", "finding_post", "task_create"]);
  });
});

// ─── resolveToolForAuth ─────────────────────────────────────

describe("resolveToolForAuth", () => {
  it("returns tool by name for api-key auth", () => {
    const registry = buildRegistry();
    const tool = resolveToolForAuth(registry, "env_list", API_KEY_AUTH);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("env_list");
  });

  it("returns scoped tool by name for scoped auth", () => {
    const registry = buildRegistry();
    const tool = resolveToolForAuth(registry, "finding_post", SCOPED_AUTH);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("finding_post");
  });

  it("rejects non-scoped tool for scoped auth", () => {
    const registry = buildRegistry();
    const tool = resolveToolForAuth(registry, "env_list", SCOPED_AUTH);
    expect(tool).toBeUndefined();
  });

  it("returns undefined for unknown tool name", () => {
    const registry = buildRegistry();
    expect(resolveToolForAuth(registry, "nonexistent", API_KEY_AUTH)).toBeUndefined();
    expect(resolveToolForAuth(registry, "nonexistent", SCOPED_AUTH)).toBeUndefined();
  });
});

// ─── listToolsForAuth ───────────────────────────────────────

describe("listToolsForAuth", () => {
  it("returns all tools for api-key auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, API_KEY_AUTH);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["env_list", "finding_list", "finding_post", "session_list", "task_create"]);
  });

  it("returns only scoped tools for scoped auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, SCOPED_AUTH);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["finding_list", "finding_post", "task_create"]);
  });

  it("does not include env_list or session_list for scoped auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, SCOPED_AUTH);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("env_list");
    expect(names).not.toContain("session_list");
  });
});
