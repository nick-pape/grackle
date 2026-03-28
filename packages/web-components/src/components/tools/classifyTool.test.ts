import { describe, it, expect } from "vitest";
import { classifyTool } from "./classifyTool.js";

describe("classifyTool", () => {
  it("classifies Claude Code tools", () => {
    expect(classifyTool("Bash")).toBe("shell");
    expect(classifyTool("Read")).toBe("file-read");
    expect(classifyTool("Edit")).toBe("file-edit");
    expect(classifyTool("Write")).toBe("file-write");
    expect(classifyTool("Grep")).toBe("search");
    expect(classifyTool("Glob")).toBe("search");
    expect(classifyTool("TodoWrite")).toBe("todo");
  });

  it("classifies Copilot tools", () => {
    expect(classifyTool("powershell")).toBe("shell");
    expect(classifyTool("view")).toBe("file-read");
    expect(classifyTool("edit")).toBe("file-edit");
    expect(classifyTool("report_intent")).toBe("metadata");
  });

  it("classifies Codex tools", () => {
    expect(classifyTool("command_execution")).toBe("shell");
    expect(classifyTool("file_change")).toBe("file-edit");
    expect(classifyTool("update_plan")).toBe("todo");
  });

  it("is case-insensitive", () => {
    expect(classifyTool("BASH")).toBe("shell");
    expect(classifyTool("PowerShell")).toBe("shell");
    expect(classifyTool("GREP")).toBe("search");
  });

  it("returns generic for unknown tools", () => {
    expect(classifyTool("unknown_tool")).toBe("generic");
    expect(classifyTool("mcp__grackle__workpad_write")).toBe("generic");
  });
});
