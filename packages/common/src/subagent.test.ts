import { describe, it, expect } from "vitest";
import {
  parseDelegationArgs,
  detectDelegation,
  delegationIdentityKey,
  deriveChildSessionId,
  readAgentResultStatus,
  type DelegationInfo,
} from "./subagent.js";

describe("parseDelegationArgs", () => {
  it("parses Claude Code Agent args (subagent_type)", () => {
    const info = parseDelegationArgs("Agent", {
      subagent_type: "Explore",
      description: "look around",
      prompt: "find the bug",
      run_in_background: true,
      model: "opus",
    });
    expect(info).toEqual<DelegationInfo>({
      agentType: "Explore",
      description: "look around",
      prompt: "find the bug",
      isBackground: true,
      model: "opus",
      isResume: false,
    });
  });

  it("parses Copilot task args (agent_type/name)", () => {
    const info = parseDelegationArgs("task", {
      agent_type: "worker",
      description: "run tests",
      prompt: "run the suite",
      mode: "background",
      name: "find-tests",
    });
    expect(info.agentType).toBe("worker");
    expect(info.agentName).toBe("find-tests");
    expect(info.isBackground).toBe(true);
    expect(info.prompt).toBe("run the suite");
  });

  it("captures agent_id on a Copilot task spawn so spawn and polls converge", () => {
    const info = parseDelegationArgs("task", {
      agent_type: "worker",
      name: "find-tests",
      agent_id: "ag-42",
      prompt: "run the suite",
    });
    expect(info.agentId).toBe("ag-42");
    // delegationIdentityKey prefers agentId — matches a later read_agent poll for ag-42.
    expect(delegationIdentityKey(info, "tc-1")).toBe("ag-42");
  });

  it("parses Copilot read_agent poll (agent_id)", () => {
    const info = parseDelegationArgs("read_agent", { agent_id: "agent-123" });
    expect(info.isPoll).toBe(true);
    expect(info.agentId).toBe("agent-123");
  });

  it("returns empty object for non-object args", () => {
    expect(parseDelegationArgs("Agent", undefined)).toEqual({});
    expect(parseDelegationArgs("Agent", null)).toEqual({});
    expect(parseDelegationArgs("Agent", "string")).toEqual({});
  });
});

describe("detectDelegation", () => {
  it("detects a Claude Code Agent spawn", () => {
    const info = detectDelegation("Agent", {
      subagent_type: "general-purpose",
      prompt: "do the thing",
    });
    expect(info).toBeDefined();
    expect(info?.agentType).toBe("general-purpose");
  });

  it("detects a Copilot task spawn (by name, no agent_type)", () => {
    const info = detectDelegation("task", { name: "reviewer", prompt: "review this" });
    expect(info).toBeDefined();
    expect(info?.agentName).toBe("reviewer");
  });

  it("detects a task identified only by agent_id + prompt", () => {
    const info = detectDelegation("task", { agent_id: "ag-7", prompt: "do it" });
    expect(info).toBeDefined();
    expect(info?.agentId).toBe("ag-7");
  });

  it("detects a Copilot read_agent poll", () => {
    const info = detectDelegation("read_agent", { agent_id: "agent-9" });
    expect(info).toBeDefined();
    expect(info?.isPoll).toBe(true);
  });

  it("rejects a read_agent poll with no agent_id", () => {
    expect(detectDelegation("read_agent", {})).toBeUndefined();
  });

  it("rejects an ordinary tool that has a prompt but no delegation id", () => {
    // e.g. a hypothetical search tool that takes a prompt
    expect(detectDelegation("search", { prompt: "query" })).toBeUndefined();
  });

  it("rejects a delegation-shaped call with an empty prompt", () => {
    expect(detectDelegation("Agent", { subagent_type: "Explore", prompt: "" })).toBeUndefined();
  });

  it("does not detect Codex-style tools (no native subagent tool)", () => {
    // Codex delegates via Grackle MCP tools, not a native subagent tool shape.
    expect(detectDelegation("shell", { command: "ls" })).toBeUndefined();
  });
});

describe("delegationIdentityKey", () => {
  it("prefers agentId (Copilot read_agent / task)", () => {
    expect(delegationIdentityKey({ agentId: "a-1", agentName: "x" }, "tc-1")).toBe("a-1");
  });

  it("falls back to agentName when no agentId", () => {
    expect(delegationIdentityKey({ agentName: "reviewer" }, "tc-1")).toBe("reviewer");
  });

  it("falls back to toolCallId when no agent identity (Claude Code)", () => {
    expect(delegationIdentityKey({ agentType: "Explore" }, "tc-42")).toBe("tc-42");
  });
});

describe("deriveChildSessionId", () => {
  it("is deterministic and prefixed", () => {
    expect(deriveChildSessionId("p1", "tc1")).toBe("sub_p1_tc1");
    expect(deriveChildSessionId("p1", "tc1")).toBe(deriveChildSessionId("p1", "tc1"));
  });

  it("sanitizes unsafe characters in the identity key", () => {
    expect(deriveChildSessionId("p1", "agent/with spaces")).toBe("sub_p1_agent-with-spaces");
  });

  it("differs by parent and by identity key", () => {
    expect(deriveChildSessionId("p1", "k")).not.toBe(deriveChildSessionId("p2", "k"));
    expect(deriveChildSessionId("p1", "a")).not.toBe(deriveChildSessionId("p1", "b"));
  });
});

describe("readAgentResultStatus", () => {
  it("parses the completed status prefix", () => {
    expect(readAgentResultStatus("Agent completed. agent_id: ag-1\n\ndone")).toBe("completed");
  });

  it("parses running, failed, and cancelled", () => {
    expect(readAgentResultStatus("Agent running. agent_id: ag-1")).toBe("running");
    expect(readAgentResultStatus("Agent failed. agent_id: ag-1")).toBe("failed");
    expect(readAgentResultStatus("Agent cancelled. agent_id: ag-1")).toBe("cancelled");
  });

  it("returns undefined for unstructured results", () => {
    expect(readAgentResultStatus("just some plain text")).toBeUndefined();
  });
});
