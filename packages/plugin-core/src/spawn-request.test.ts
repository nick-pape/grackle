/**
 * Unit tests for the createSession (AHP HR4+5) config→PowerLine wire mapping
 * (task_id plumbing + optional use_worktrees passthrough). Cascade resolution
 * tests live in `resolve-spawn-spec.test.ts` (#1427).
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { buildCreateSessionParams } from "./spawn-request.js";

const serverInputs = {
  sessionId: "sess-1",
  runtime: "claude-code",
  model: "sonnet",
  prompt: "do the thing",
  maxTurns: 0,
  systemContext: "ctx",
  mcpServersJson: "[]",
  mcpUrl: "http://127.0.0.1:7435/mcp",
  mcpToken: "tok",
  scriptContent: "",
  workingDirectory: "",
  workspaceId: "",
};

describe("buildCreateSessionParams", () => {
  it("plumbs task_id from config (no longer hardcoded empty)", () => {
    const config = create(grackle.SessionConfigSchema, {
      taskId: "task-42",
      branch: "feat",
      pipe: "async",
    });
    const req = buildCreateSessionParams({ ...serverInputs, config });

    expect(req.taskId).toBe("task-42");
    expect(req.branch).toBe("feat");
    expect(req.pipe).toBe("async");
  });

  it("passes use_worktrees=false through explicitly", () => {
    const config = create(grackle.SessionConfigSchema, { useWorktrees: false });
    expect(buildCreateSessionParams({ ...serverInputs, config }).useWorktrees).toBe(false);
  });

  it("passes use_worktrees=true through explicitly", () => {
    const config = create(grackle.SessionConfigSchema, { useWorktrees: true });
    expect(buildCreateSessionParams({ ...serverInputs, config }).useWorktrees).toBe(true);
  });

  it("leaves use_worktrees unset when config omits it (host default applies)", () => {
    const config = create(grackle.SessionConfigSchema, {});
    expect(buildCreateSessionParams({ ...serverInputs, config }).useWorktrees).toBeUndefined();
  });

  it("defaults cleanly when config is undefined", () => {
    const req = buildCreateSessionParams({ ...serverInputs, config: undefined });

    expect(req.taskId).toBe("");
    expect(req.branch).toBe("");
    expect(req.pipe).toBe("");
    expect(req.useWorktrees).toBeUndefined();
  });

  it("forwards server-resolved values verbatim", () => {
    const req = buildCreateSessionParams({ ...serverInputs, config: undefined });

    expect(req.sessionId).toBe("sess-1");
    expect(req.runtime).toBe("claude-code");
    expect(req.model).toBe("sonnet");
    expect(req.mcpToken).toBe("tok");
    expect(req.systemContext).toBe("ctx");
  });

  it("forwards a resolved workspaceId, leaving it unset when empty", () => {
    expect(
      buildCreateSessionParams({ ...serverInputs, workspaceId: "ws-1", config: undefined })
        .workspaceId,
    ).toBe("ws-1");
    expect(
      buildCreateSessionParams({ ...serverInputs, workspaceId: "", config: undefined }).workspaceId,
    ).toBeUndefined();
  });
});
