import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { ToolRegistry } from "./tool-registry.js";
import type { ToolDefinition } from "./tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
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
  registry.register(makeTool("workpad_write"));
  registry.register(makeTool("workpad_read"));
  registry.register(makeTool("task_create"));
  registry.register(makeTool("task_list"));
  registry.register(makeTool("task_show"));
  registry.register(makeTool("task_start"));
  registry.register(makeTool("task_complete"));
  registry.register(makeTool("session_send_input"));
  registry.register(makeTool("persona_list"));
  registry.register(makeTool("persona_show"));
  registry.register(makeTool("env_list"));
  registry.register(makeTool("session_list"));
  return registry;
}

const API_KEY_AUTH: AuthContext = { type: "api-key" };

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "task-1",
  workspaceId: "proj-1",
  personaId: "",
  taskSessionId: "sess-1",
};

const ROOT_TASK_AUTH: AuthContext = {
  type: "scoped",
  taskId: ROOT_TASK_ID,
  workspaceId: "proj-1",
  personaId: "",
  taskSessionId: "sess-root",
};

// ─── SCOPED_TOOLS constant ──────────────────────────────────

describe("SCOPED_TOOLS", () => {
  it("contains the expected scoped tools", () => {
    expect([...SCOPED_TOOLS].sort()).toEqual([
      "component_show",
      "ipc_attach", "ipc_close", "ipc_create_stream", "ipc_list_fds", "ipc_share_stream", "ipc_spawn", "ipc_terminate", "ipc_write",
      "knowledge_get_node", "knowledge_search",
      "logs_get",
      "persona_list", "persona_show",
      "schedule_list", "schedule_show",
      "session_attach", "session_send_input",
      "show_hello_widget",
      "task_complete", "task_create", "task_list", "task_search", "task_show", "task_start",
      "widget_list", "widget_register", "widget_render", "widget_show", "widget_update",
      "workpad_read", "workpad_write",
    ]);
  });
});

// ─── resolveToolForAuth (backward compat — no persona tools) ─

describe("resolveToolForAuth", () => {
  it("returns tool by name for api-key auth", () => {
    const registry = buildRegistry();
    const tool = resolveToolForAuth(registry, "env_list", API_KEY_AUTH);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("env_list");
  });

  it("returns scoped tool by name for scoped auth", () => {
    const registry = buildRegistry();
    const tool = resolveToolForAuth(registry, "workpad_write", SCOPED_AUTH);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("workpad_write");
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

// ─── listToolsForAuth (backward compat — no persona tools) ──

describe("listToolsForAuth", () => {
  it("returns all tools for api-key auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, API_KEY_AUTH);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "env_list",
      "persona_list", "persona_show",
      "session_list", "session_send_input",
      "task_complete", "task_create", "task_list", "task_show", "task_start",
      "workpad_read", "workpad_write",
    ]);
  });

  it("returns only scoped tools for scoped auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, SCOPED_AUTH);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "persona_list", "persona_show",
      "session_send_input",
      "task_complete", "task_create", "task_list", "task_show", "task_start",
      "workpad_read", "workpad_write",
    ]);
  });

  it("does not include env_list or session_list for scoped auth", () => {
    const registry = buildRegistry();
    const tools = listToolsForAuth(registry, SCOPED_AUTH);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("env_list");
    expect(names).not.toContain("session_list");
  });
});

// ─── Persona-scoped tool filtering ──────────────────────────

describe("persona-scoped filtering", () => {
  it("restricts tools to persona's allowed set", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write"]);
    const tools = listToolsForAuth(registry, SCOPED_AUTH, personaTools);
    expect(tools.map((t) => t.name)).toEqual(["workpad_write"]);
  });

  it("resolves only persona-allowed tools", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write"]);
    expect(resolveToolForAuth(registry, "workpad_write", SCOPED_AUTH, personaTools)).toBeDefined();
    expect(resolveToolForAuth(registry, "task_create", SCOPED_AUTH, personaTools)).toBeUndefined();
    expect(resolveToolForAuth(registry, "env_list", SCOPED_AUTH, personaTools)).toBeUndefined();
  });

  it("falls back to SCOPED_TOOLS when personaAllowedTools is undefined", () => {
    const registry = buildRegistry();
    const withoutPersona = listToolsForAuth(registry, SCOPED_AUTH, undefined);
    const defaultTools = listToolsForAuth(registry, SCOPED_AUTH);
    expect(withoutPersona.map((t) => t.name).sort()).toEqual(
      defaultTools.map((t) => t.name).sort(),
    );
  });

  it("api-key auth ignores personaAllowedTools", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write"]);
    const tools = listToolsForAuth(registry, API_KEY_AUTH, personaTools);
    // Full access — all 12 tools in the test registry
    expect(tools).toHaveLength(12);
  });

  it("root task gets full access even with personaAllowedTools set", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write"]);
    const tools = listToolsForAuth(registry, ROOT_TASK_AUTH, personaTools);
    expect(tools).toHaveLength(12);
  });

  it("root task can resolve any tool regardless of personaAllowedTools", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write"]);
    expect(resolveToolForAuth(registry, "env_list", ROOT_TASK_AUTH, personaTools)).toBeDefined();
  });

  it("supports multiple persona tools", () => {
    const registry = buildRegistry();
    const personaTools = new Set(["workpad_write", "task_create", "task_list"]);
    const tools = listToolsForAuth(registry, SCOPED_AUTH, personaTools);
    expect(tools.map((t) => t.name).sort()).toEqual(["task_create", "task_list", "workpad_write"]);
  });
});
