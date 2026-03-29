import { describe, it, expect } from "vitest";
import { formatToolName } from "./GenericToolCard.js";
import { simplifyCommand } from "./ShellCard.js";

describe("formatToolName", () => {
  it("parses standard MCP tool names", () => {
    expect(formatToolName("mcp__server__tool")).toEqual({ display: "server / tool", isMcp: true });
    expect(formatToolName("mcp__my-server__my-tool")).toEqual({ display: "my-server / my-tool", isMcp: true });
  });

  it("preserves underscores within server and tool segments", () => {
    expect(formatToolName("mcp__qdrant-search__semantic_search")).toEqual({ display: "qdrant-search / semantic_search", isMcp: true });
    expect(formatToolName("mcp__grackle__env_add")).toEqual({ display: "grackle / env_add", isMcp: true });
    expect(formatToolName("mcp__playwright__browser_navigate")).toEqual({ display: "playwright / browser_navigate", isMcp: true });
  });

  it("splits only at the first double-underscore boundary", () => {
    expect(formatToolName("mcp__server__some__deep__tool")).toEqual({ display: "server / some__deep__tool", isMcp: true });
  });

  it("returns non-MCP tools unchanged", () => {
    expect(formatToolName("Bash")).toEqual({ display: "Bash", isMcp: false });
    expect(formatToolName("not_mcp_tool")).toEqual({ display: "not_mcp_tool", isMcp: false });
  });

  it("rejects malformed MCP names", () => {
    expect(formatToolName("mcp____tool")).toEqual({ display: "mcp____tool", isMcp: false });
    expect(formatToolName("mcp__server__")).toEqual({ display: "mcp__server__", isMcp: false });
  });
});

describe("simplifyCommand", () => {
  it("strips single-quoted pwsh wrapper", () => {
    expect(simplifyCommand("pwsh -Command 'Get-Process'")).toBe("Get-Process");
  });

  it("strips double-quoted pwsh wrapper", () => {
    expect(simplifyCommand("pwsh -Command \"Get-Process\"")).toBe("Get-Process");
  });

  it("handles pwsh.exe with path prefix", () => {
    expect(simplifyCommand("pwsh.exe -Command 'ls -la'")).toBe("ls -la");
  });

  it("handles trailing whitespace", () => {
    expect(simplifyCommand("pwsh -Command 'echo hello'  ")).toBe("echo hello");
  });

  it("returns non-pwsh commands unchanged", () => {
    expect(simplifyCommand("git status")).toBe("git status");
    expect(simplifyCommand("ls -la")).toBe("ls -la");
  });
});
