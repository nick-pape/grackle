/**
 * Tests for the MCP server JSON helper. Pure function, no IO.
 */
import { describe, it, expect } from "vitest";

import { buildMcpServersJson } from "./grpc-mcp-config.js";

describe("buildMcpServersJson", () => {
  it("emits one entry per server with default empty args", () => {
    const json = buildMcpServersJson([{ name: "fs", command: "fs-mcp" }]);
    expect(JSON.parse(json)).toEqual({ fs: { command: "fs-mcp", args: [] } });
  });

  it("preserves provided args", () => {
    const json = buildMcpServersJson([{ name: "fs", command: "fs-mcp", args: ["--root", "/x"] }]);
    expect(JSON.parse(json)).toEqual({ fs: { command: "fs-mcp", args: ["--root", "/x"] } });
  });

  it("includes tools only when non-empty", () => {
    const withTools = JSON.parse(
      buildMcpServersJson([{ name: "fs", command: "fs-mcp", tools: ["read"] }]),
    );
    const withoutTools = JSON.parse(
      buildMcpServersJson([{ name: "fs", command: "fs-mcp", tools: [] }]),
    );
    expect(withTools.fs.tools).toEqual(["read"]);
    expect(withoutTools.fs.tools).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    expect(JSON.parse(buildMcpServersJson([]))).toEqual({});
  });
});
