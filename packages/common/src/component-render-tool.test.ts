import { describe, it, expect } from "vitest";
import {
  RENDER_TOOL_PREFIX,
  componentRenderToolName,
  selectPromotedRenderTools,
} from "./component-render-tool.js";
import { ALL_MCP_TOOL_NAMES } from "./mcp-tool-presets.js";

describe("componentRenderToolName", () => {
  it("slugs a simple name", () => {
    expect(componentRenderToolName("RevenueChart")).toBe("render_RevenueChart");
  });

  it("replaces spaces and punctuation with underscores", () => {
    expect(componentRenderToolName("Revenue Chart")).toBe("render_Revenue_Chart");
    expect(componentRenderToolName("cost/summary.v2")).toBe("render_cost_summary_v2");
  });

  it("collapses runs and trims leading/trailing underscores", () => {
    expect(componentRenderToolName("  --weird-- name!! ")).toBe("render_weird_name");
  });

  it("returns undefined for names with no usable characters", () => {
    expect(componentRenderToolName("")).toBeUndefined();
    expect(componentRenderToolName("   ")).toBeUndefined();
    expect(componentRenderToolName("!!!")).toBeUndefined();
  });
});

describe("RENDER_TOOL_PREFIX is reserved", () => {
  it("no statically-registered MCP tool name uses the render_ prefix", () => {
    for (const name of ALL_MCP_TOOL_NAMES) {
      expect(
        name.startsWith(RENDER_TOOL_PREFIX),
        `${name} must not use the reserved render_ prefix`,
      ).toBe(false);
    }
  });
});

describe("selectPromotedRenderTools", () => {
  const comp = (
    name: string,
    promoted: boolean,
    id = name,
  ): { id: string; name: string; promoted: boolean } => ({ id, name, promoted });

  it("selects only promoted components, paired with their tool name", () => {
    const out = selectPromotedRenderTools([
      comp("Chart", true),
      comp("Draft", false),
      comp("Table", true),
    ]);
    expect(out.map((e) => e.toolName)).toEqual(["render_Chart", "render_Table"]);
    expect(out.map((e) => e.component.name)).toEqual(["Chart", "Table"]);
  });

  it("skips components whose name yields no slug", () => {
    expect(selectPromotedRenderTools([comp("!!!", true)])).toEqual([]);
  });

  it("resolves tool-name collisions to the first (most-recently-updated) component", () => {
    // Both names slug to render_revenue_chart; caller supplies updatedAt DESC, so the first wins.
    const out = selectPromotedRenderTools([
      comp("revenue chart", true, "newer"),
      comp("revenue/chart", true, "older"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.toolName).toBe("render_revenue_chart");
    expect(out[0]!.component.id).toBe("newer");
  });
});
