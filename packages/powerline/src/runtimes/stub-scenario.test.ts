import { describe, it, expect, beforeEach } from "vitest";
import {
  parseScenario,
  buildEventFromEmitStep,
  resetToolUseCounter,
} from "./stub-scenario.js";
import type { EmitStep } from "./stub-scenario.js";

describe("parseScenario", () => {
  it("parses raw JSON prompt", () => {
    const result = parseScenario('{"steps": [{"emit": "text", "content": "hello"}]}');
    expect(result).toBeDefined();
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]).toEqual({ emit: "text", content: "hello" });
  });

  it("parses SCENARIO: prefix in multi-line prompt", () => {
    const prompt = 'Task Title\n\nSCENARIO: {"steps": [{"idle": true}]}';
    const result = parseScenario(prompt);
    expect(result).toBeDefined();
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]).toEqual({ idle: true });
  });

  it("handles case-insensitive SCENARIO prefix", () => {
    const prompt = 'Title\n\nscenario: {"steps": [{"wait": 100}]}';
    const result = parseScenario(prompt);
    expect(result).toBeDefined();
    expect(result!.steps[0]).toEqual({ wait: 100 });
  });

  it("returns undefined for plain text", () => {
    expect(parseScenario("Hello world")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseScenario("{broken")).toBeUndefined();
  });

  it("returns undefined for JSON without steps array", () => {
    expect(parseScenario('{"foo": 1}')).toBeUndefined();
  });

  it("returns undefined for empty prompt", () => {
    expect(parseScenario("")).toBeUndefined();
  });

  it("parses scenario JSON embedded as description in task prompt", () => {
    // buildTaskPrompt produces "title\n\ndescription" — the JSON is on line 3
    const prompt = 'test task\n\n{"steps": [{"emit": "text", "content": "hello"}]}';
    const result = parseScenario(prompt);
    expect(result).toBeDefined();
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]).toEqual({ emit: "text", content: "hello" });
  });

  it("ignores non-scenario JSON lines in multi-line prompt", () => {
    // A line with { but not a valid scenario should not match
    const prompt = 'task title\n\n{"notAScenario": true}\n\nmore text';
    expect(parseScenario(prompt)).toBeUndefined();
  });

  it("parses scenario with multiple step types", () => {
    const scenario = {
      steps: [
        { emit: "text", content: "Working..." },
        { wait: 500 },
        { idle: true },
        { on_input: "echo" },
        { on_input_match: { fail: "fail", "*": "next" } },
      ],
    };
    const result = parseScenario(JSON.stringify(scenario));
    expect(result).toBeDefined();
    expect(result!.steps).toHaveLength(5);
  });
});

describe("buildEventFromEmitStep", () => {
  beforeEach(() => {
    resetToolUseCounter();
  });

  it("builds basic text event", () => {
    const step: EmitStep = { emit: "text", content: "hello" };
    const [event, toolUseId] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("text");
    expect(event.content).toBe("hello");
    expect(event.raw).toBeUndefined();
    expect(toolUseId).toBeUndefined();
  });

  it("normalizes tool_use with tool/args convenience fields", () => {
    const step: EmitStep = { emit: "tool_use", tool: "read_file", args: { path: "/foo" } };
    const [event, toolUseId] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("tool_use");
    expect(JSON.parse(event.content)).toEqual({ tool: "read_file", args: { path: "/foo" } });
    expect(event.raw).toEqual({
      type: "tool_use",
      id: "toolu_scenario_1",
      name: "read_file",
      input: { path: "/foo" },
    });
    expect(toolUseId).toBe("toolu_scenario_1");
  });

  it("preserves explicit raw on tool_use", () => {
    const customRaw = { type: "tool_use", id: "custom_id", name: "test" };
    const step: EmitStep = { emit: "tool_use", tool: "test", raw: customRaw };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.raw).toEqual(customRaw);
  });

  it("normalizes tool_result with auto-generated raw", () => {
    const step: EmitStep = { emit: "tool_result", content: "file contents here" };
    const [event, toolUseId] = buildEventFromEmitStep(step, "toolu_scenario_1");

    expect(event.type).toBe("tool_result");
    expect(event.content).toBe("file contents here");
    expect(event.raw).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_scenario_1",
      is_error: false,
    });
    expect(toolUseId).toBeUndefined();
  });

  it("uses 'unknown' for tool_result raw when no lastToolUseId", () => {
    const step: EmitStep = { emit: "tool_result", content: "result" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect((event.raw as Record<string, unknown>).tool_use_id).toBe("unknown");
  });

  it("normalizes subtask_create with title/description", () => {
    const step: EmitStep = { emit: "subtask_create", title: "Fix bug", description: "Fix the auth bug" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("subtask_create");
    expect(JSON.parse(event.content)).toEqual({ title: "Fix bug", description: "Fix the auth bug" });
  });

  it("uses explicit content over convenience fields for subtask_create", () => {
    const step: EmitStep = { emit: "subtask_create", content: "custom content", title: "ignored" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.content).toBe("custom content");
  });

  it("increments tool_use IDs across calls", () => {
    const step: EmitStep = { emit: "tool_use", tool: "a" };
    const [, id1] = buildEventFromEmitStep(step, undefined);
    const [, id2] = buildEventFromEmitStep(step, undefined);

    expect(id1).toBe("toolu_scenario_1");
    expect(id2).toBe("toolu_scenario_2");
  });

  it("builds finding event", () => {
    const step: EmitStep = { emit: "finding", content: "Found a bug in auth.ts" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("finding");
    expect(event.content).toBe("Found a bug in auth.ts");
  });

  it("builds error event", () => {
    const step: EmitStep = { emit: "error", content: "Something went wrong" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("error");
    expect(event.content).toBe("Something went wrong");
  });

  it("builds usage event", () => {
    const step: EmitStep = { emit: "usage", content: '{"inputTokens": 100, "outputTokens": 50}' };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.type).toBe("usage");
    expect(event.content).toBe('{"inputTokens": 100, "outputTokens": 50}');
  });

  it("includes timestamp as ISO string", () => {
    const step: EmitStep = { emit: "text", content: "hi" };
    const [event] = buildEventFromEmitStep(step, undefined);

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
