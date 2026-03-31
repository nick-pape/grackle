import { describe, it, expect } from "vitest";
import {
  ALL_MCP_TOOL_NAMES,
  DEFAULT_SCOPED_MCP_TOOLS,
  WORKER_MCP_TOOLS,
  ORCHESTRATOR_MCP_TOOLS,
  ADMIN_MCP_TOOLS,
  MCP_TOOL_PRESETS,
} from "./mcp-tool-presets.js";

describe("ALL_MCP_TOOL_NAMES", () => {
  it("contains exactly 65 tool names", () => {
    expect(ALL_MCP_TOOL_NAMES.size).toBe(65);
  });

  it("includes tools from every group", () => {
    const groups = [
      "config_get_default_persona",
      "credential_provider_list",
      "env_list",
      "finding_post",
      "ipc_spawn",
      "knowledge_search",
      "logs_get",
      "persona_list",
      "session_spawn",
      "task_list",
      "token_list",
      "usage_get",
      "get_version_status",
      "schedule_list",
      "workpad_write",
      "workspace_list",
    ];
    for (const tool of groups) {
      expect(ALL_MCP_TOOL_NAMES.has(tool)).toBe(true);
    }
  });
});

describe("DEFAULT_SCOPED_MCP_TOOLS", () => {
  it("contains the current default scoped tools", () => {
    expect([...DEFAULT_SCOPED_MCP_TOOLS].sort()).toEqual([
      "finding_list", "finding_post",
      "ipc_attach", "ipc_close", "ipc_create_stream", "ipc_list_fds", "ipc_spawn", "ipc_terminate", "ipc_write",
      "knowledge_get_node", "knowledge_search",
      "logs_get",
      "persona_list", "persona_show",
      "schedule_list", "schedule_show",
      "session_attach", "session_send_input",
      "task_complete", "task_create", "task_list", "task_search", "task_show", "task_start",
      "workpad_read", "workpad_write",
    ]);
  });

  it("every tool is a valid MCP tool name", () => {
    for (const tool of DEFAULT_SCOPED_MCP_TOOLS) {
      expect(ALL_MCP_TOOL_NAMES.has(tool)).toBe(true);
    }
  });
});

describe("WORKER_MCP_TOOLS", () => {
  it("is a subset of DEFAULT_SCOPED_MCP_TOOLS", () => {
    const defaultSet = new Set(DEFAULT_SCOPED_MCP_TOOLS);
    for (const tool of WORKER_MCP_TOOLS) {
      expect(defaultSet.has(tool)).toBe(true);
    }
  });

  it("does not include task_create (workers cannot create subtasks)", () => {
    expect(WORKER_MCP_TOOLS).not.toContain("task_create");
  });

  it("every tool is a valid MCP tool name", () => {
    for (const tool of WORKER_MCP_TOOLS) {
      expect(ALL_MCP_TOOL_NAMES.has(tool)).toBe(true);
    }
  });
});

describe("ORCHESTRATOR_MCP_TOOLS", () => {
  it("is a superset of DEFAULT_SCOPED_MCP_TOOLS", () => {
    const orchestratorSet = new Set(ORCHESTRATOR_MCP_TOOLS);
    for (const tool of DEFAULT_SCOPED_MCP_TOOLS) {
      expect(orchestratorSet.has(tool)).toBe(true);
    }
  });

  it("includes additional management tools beyond default", () => {
    const extras = [
      "task_update", "task_delete", "task_resume",
      "session_spawn", "session_kill", "session_status",
      "persona_create",
      "knowledge_create_node",
    ];
    for (const tool of extras) {
      expect(ORCHESTRATOR_MCP_TOOLS).toContain(tool);
    }
  });

  it("every tool is a valid MCP tool name", () => {
    for (const tool of ORCHESTRATOR_MCP_TOOLS) {
      expect(ALL_MCP_TOOL_NAMES.has(tool)).toBe(true);
    }
  });
});

describe("ADMIN_MCP_TOOLS", () => {
  it("contains all 65 tool names", () => {
    expect(ADMIN_MCP_TOOLS).toHaveLength(65);
  });

  it("matches ALL_MCP_TOOL_NAMES exactly", () => {
    expect(new Set(ADMIN_MCP_TOOLS)).toEqual(ALL_MCP_TOOL_NAMES);
  });
});

describe("escalate_to_human scoping", () => {
  it("is NOT in DEFAULT_SCOPED_MCP_TOOLS", () => {
    expect(DEFAULT_SCOPED_MCP_TOOLS).not.toContain("escalate_to_human");
  });

  it("is NOT in WORKER_MCP_TOOLS", () => {
    expect(WORKER_MCP_TOOLS).not.toContain("escalate_to_human");
  });

  it("IS in ORCHESTRATOR_MCP_TOOLS", () => {
    expect(ORCHESTRATOR_MCP_TOOLS).toContain("escalate_to_human");
  });

  it("IS in ADMIN_MCP_TOOLS", () => {
    expect(ADMIN_MCP_TOOLS).toContain("escalate_to_human");
  });

  it("escalation_list and escalation_acknowledge are in ALL_MCP_TOOL_NAMES", () => {
    expect(ALL_MCP_TOOL_NAMES.has("escalation_list")).toBe(true);
    expect(ALL_MCP_TOOL_NAMES.has("escalation_acknowledge")).toBe(true);
  });
});

describe("MCP_TOOL_PRESETS", () => {
  it("has the expected preset keys", () => {
    expect(Object.keys(MCP_TOOL_PRESETS).sort()).toEqual([
      "admin", "default", "orchestrator", "worker",
    ]);
  });

  it("maps to the correct arrays", () => {
    expect(MCP_TOOL_PRESETS.default).toBe(DEFAULT_SCOPED_MCP_TOOLS);
    expect(MCP_TOOL_PRESETS.worker).toBe(WORKER_MCP_TOOLS);
    expect(MCP_TOOL_PRESETS.orchestrator).toBe(ORCHESTRATOR_MCP_TOOLS);
    expect(MCP_TOOL_PRESETS.admin).toBe(ADMIN_MCP_TOOLS);
  });
});
