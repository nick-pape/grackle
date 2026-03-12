import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger before importing the module under test
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { mapMessage } from "./claude-code.js";

describe("mapMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
  });

  describe("assistant messages", () => {
    it("maps a text block to a text event", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("text");
      expect(events[0].content).toBe("Hello world");
      expect(events[0].raw).toEqual({ type: "text", text: "Hello world" });
    });

    it("maps a tool_use block to a tool_use event with JSON content", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "read_file", input: { path: "/tmp/test" } },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
      const parsed = JSON.parse(events[0].content);
      expect(parsed.tool).toBe("read_file");
      expect(parsed.args).toEqual({ path: "/tmp/test" });
    });

    it("maps a tool_result block to a tool_result event", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_result", content: "file contents here" }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_result");
      expect(events[0].content).toBe("file contents here");
    });

    it("maps tool_result with non-string content to JSON", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_result", content: { key: "value" } }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('{"key":"value"}');
    });

    it("preserves order of mixed blocks", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "first" },
            { type: "tool_use", name: "bash", input: { cmd: "ls" } },
            { type: "tool_result", content: "output" },
            { type: "text", text: "last" },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.type)).toEqual(["text", "tool_use", "tool_result", "text"]);
    });

    it("returns empty array for empty content", () => {
      const msg = {
        type: "assistant",
        message: { role: "assistant", content: [] },
      };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("returns empty array for non-array content", () => {
      const msg = {
        type: "assistant",
        message: { role: "assistant", content: "just a string" },
      };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("returns empty array when message is missing", () => {
      const msg = { type: "assistant" };
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("finding interception", () => {
    it("emits finding event for post_finding tool call", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "post_finding",
              input: {
                title: "Bug Found",
                content: "There is a bug here",
                category: "bug",
                tags: ["critical"],
              },
            },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(2); // tool_use + finding
      expect(events[0].type).toBe("tool_use");
      expect(events[1].type).toBe("finding");

      const finding = JSON.parse(events[1].content);
      expect(finding.title).toBe("Bug Found");
      expect(finding.content).toBe("There is a bug here");
      expect(finding.category).toBe("bug");
      expect(finding.tags).toEqual(["critical"]);
    });

    it("emits finding event for mcp__grackle__post_finding", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "mcp__grackle__post_finding",
              input: { title: "MCP Finding", content: "via MCP" },
            },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("finding");

      const finding = JSON.parse(events[1].content);
      expect(finding.title).toBe("MCP Finding");
    });

    it("applies defaults for missing finding fields", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "post_finding",
              input: {},
            },
          ],
        },
      };
      const events = mapMessage(msg);
      const finding = JSON.parse(events[1].content);
      expect(finding.title).toBe("Untitled");
      expect(finding.content).toBe("");
      expect(finding.category).toBe("general");
      expect(finding.tags).toEqual([]);
    });

    it("does not emit finding for regular tools", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "read_file", input: { path: "/tmp" } },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
    });
  });

  describe("subtask creation interception", () => {
    it("emits subtask_create event for create_subtask tool call", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "create_subtask",
              input: {
                title: "Design API",
                description: "Design REST endpoints",
                local_id: "design",
                depends_on: [],
                can_decompose: false,
              },
            },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(2); // tool_use + subtask_create
      expect(events[0].type).toBe("tool_use");
      expect(events[1].type).toBe("subtask_create");

      const subtask = JSON.parse(events[1].content);
      expect(subtask.title).toBe("Design API");
      expect(subtask.description).toBe("Design REST endpoints");
      expect(subtask.local_id).toBe("design");
      expect(subtask.can_decompose).toBe(false);
    });

    it("emits subtask_create event for mcp__grackle__create_subtask", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "mcp__grackle__create_subtask",
              input: { title: "MCP Subtask", description: "via MCP" },
            },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe("subtask_create");

      const subtask = JSON.parse(events[1].content);
      expect(subtask.title).toBe("MCP Subtask");
    });

    it("does not emit subtask_create for unrelated tools", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "read_file", input: { path: "/tmp" } },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
    });
  });

  describe("system messages", () => {
    it("init subtype produces system event with model", () => {
      const msg = { type: "system", subtype: "init", model: "claude-3" };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("system");
      expect(events[0].content).toBe("Session initialized (claude-3)");
    });

    it("init subtype uses 'unknown model' when model is missing", () => {
      const msg = { type: "system", subtype: "init" };
      const events = mapMessage(msg);
      expect(events[0].content).toBe("Session initialized (unknown model)");
    });

    it("non-init subtype returns empty array", () => {
      const msg = { type: "system", subtype: "other" };
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("result and unknown messages", () => {
    it("result type returns empty array", () => {
      const msg = { type: "result", result: "done" };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("unknown type returns empty array", () => {
      const msg = { type: "something_else" };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("missing type returns empty array", () => {
      const msg = {};
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("timestamps", () => {
    it("all events have ISO timestamp", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", name: "t", input: {} },
          ],
        },
      };
      const events = mapMessage(msg);
      for (const event of events) {
        expect(event.timestamp).toBe("2025-01-15T12:00:00.000Z");
      }
    });
  });
});

describe("ClaudeCodeRuntime structural", () => {
  // Can't test full stream() without the SDK, but verify basic structure
  it("has name 'claude-code'", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    expect(runtime.name).toBe("claude-code");
  });

  it("spawn returns a session with correct properties", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-1",
      prompt: "test",
      model: "claude-3",
      maxTurns: 10,
    });
    expect(session.id).toBe("cc-1");
    expect(session.runtimeName).toBe("claude-code");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.resume({
      sessionId: "cc-resume",
      runtimeSessionId: "prev-session-123",
    });
    expect(session.id).toBe("cc-resume");
    expect(session.runtimeSessionId).toBe("prev-session-123");
  });
});
