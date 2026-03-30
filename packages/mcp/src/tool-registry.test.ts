import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "./tool-registry.js";
import { createToolRegistry } from "./tools/index.js";

function createTestTool(name: string): ToolDefinition {
  return {
    name,
    group: "test",
    description: `Test tool: ${name} — used for unit testing`,
    inputSchema: z.object({}),
    rpcMethod: "testMethod",
    mutating: false,
    async handler() {
      return { content: [{ type: "text" as const, text: `result from ${name}` }] };
    },
  };
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool by name", () => {
    const registry = new ToolRegistry();
    const tool = createTestTool("my_tool");
    registry.register(tool);

    expect(registry.get("my_tool")).toBe(tool);
  });

  it("returns undefined for unknown tool names", () => {
    const registry = new ToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(createTestTool("duplicate"));

    expect(() => registry.register(createTestTool("duplicate")))
      .toThrow("Duplicate tool name: duplicate");
  });

  it("lists all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(createTestTool("alpha"));
    registry.register(createTestTool("beta"));
    registry.register(createTestTool("gamma"));

    const tools = registry.list();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns an empty array when no tools are registered", () => {
    const registry = new ToolRegistry();
    expect(registry.list()).toEqual([]);
  });

  it("filters tools with a predicate", () => {
    const registry = new ToolRegistry();
    const readOnlyTool: ToolDefinition = {
      ...createTestTool("readonly_tool"),
      annotations: { readOnlyHint: true },
    };
    const writeTool: ToolDefinition = {
      ...createTestTool("write_tool"),
      annotations: { readOnlyHint: false },
    };
    registry.register(readOnlyTool);
    registry.register(writeTool);

    const readOnly = registry.list((t) => t.annotations?.readOnlyHint === true);
    expect(readOnly).toHaveLength(1);
    expect(readOnly[0].name).toBe("readonly_tool");
  });

  it("returns all tools when predicate is undefined", () => {
    const registry = new ToolRegistry();
    registry.register(createTestTool("one"));
    registry.register(createTestTool("two"));

    const tools = registry.list(undefined);
    expect(tools).toHaveLength(2);
  });

  it("executes a tool handler", async () => {
    const registry = new ToolRegistry();
    registry.register(createTestTool("exec_test"));

    const tool = registry.get("exec_test")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.handler({}, {} as any);
    expect(result.content[0].text).toBe("result from exec_test");
  });

  it("registers an array of tools with registerAll", () => {
    const registry = new ToolRegistry();
    registry.registerAll([
      createTestTool("batch_one"),
      createTestTool("batch_two"),
      createTestTool("batch_three"),
    ]);

    expect(registry.list()).toHaveLength(3);
  });
});

// Token tools (token_set, token_list, token_delete) are intentionally excluded from
// the MCP surface — tokens contain secrets and should not be managed by AI agents.
describe("Full tool registry", () => {
  it("contains exactly the expected number of tools", () => {
    const registry = createToolRegistry();
    expect(registry.list()).toHaveLength(65);
  });

  it("every tool name matches snake_case pattern", () => {
    const registry = createToolRegistry();
    for (const tool of registry.list()) {
      expect(tool.name).toMatch(/^[a-z]+_[a-z_]+$/);
    }
  });

  it("every tool has all required fields", () => {
    const registry = createToolRegistry();
    for (const tool of registry.list()) {
      expect(tool.name).toBeTruthy();
      expect(tool.group).toBeTruthy();
      expect(tool.description.length).toBeGreaterThanOrEqual(20);
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.rpcMethod).toBeTruthy();
      expect(typeof tool.mutating).toBe("boolean");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("read-only tools have mutating=false", () => {
    const registry = createToolRegistry();
    const readOnlyNames = new Set([
      "env_list",
      "session_status",
      "session_attach",
      "workspace_list",
      "workspace_get",
      "task_list",
      "task_show",
      "finding_list",
      "persona_list",
      "persona_show",
      "logs_get",
      "config_get_default_persona",
    ]);

    for (const tool of registry.list()) {
      if (readOnlyNames.has(tool.name)) {
        expect(tool.mutating, `${tool.name} should not be mutating`).toBe(false);
      }
    }
  });

  it("has no duplicate tool names", () => {
    const registry = createToolRegistry();
    const names = registry.list().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("groups are consistent within tool files", () => {
    const registry = createToolRegistry();
    const expectedGroups = new Set([
      "env", "session", "workspace", "task", "finding", "persona", "logs", "credential", "token", "config", "ipc", "usage", "knowledge", "workpad", "schedule", "system", "escalation",
    ]);
    for (const tool of registry.list()) {
      expect(expectedGroups.has(tool.group), `unexpected group: ${tool.group}`).toBe(true);
    }
  });
});
