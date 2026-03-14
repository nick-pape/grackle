import { describe, it, expect } from "vitest";
import { ToolRegistry, type ToolDefinition } from "./tool-registry.js";

function createTestTool(name: string): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: "object" },
    async handler() {
      return { content: [{ type: "text", text: `result from ${name}` }] };
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
});
