/**
 * Tests for the persona MCP server JSON helpers. Pure functions, no IO.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildMcpServersJson, personaMcpServersToJson } from "./grpc-mcp-config.js";

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

describe("personaMcpServersToJson", () => {
  it("parses + reformats a valid JSON array", () => {
    const input = JSON.stringify([{ name: "fs", command: "fs-mcp" }]);
    const out = personaMcpServersToJson(input, "persona-1");
    expect(JSON.parse(out)).toEqual({ fs: { command: "fs-mcp", args: [] } });
  });

  it("returns empty string for empty / unset input", () => {
    expect(personaMcpServersToJson("", "p")).toBe("");
    expect(personaMcpServersToJson("[]", "p")).toBe("");
  });

  it("returns empty string for non-array JSON", () => {
    expect(personaMcpServersToJson('{"foo": "bar"}', "p")).toBe("");
  });

  it("returns empty string for malformed JSON (logged + swallowed)", () => {
    expect(personaMcpServersToJson("not json {", "p")).toBe("");
  });
});
