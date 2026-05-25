/**
 * Unit tests for the createSession (AHP HR4+5) spawn-shape helpers:
 * runtime/model override resolution and the config→PowerLine wire mapping
 * (task_id plumbing + optional use_worktrees passthrough).
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { resolveSpawnSelection, buildPowerlineSpawnRequest } from "./spawn-request.js";

const persona = { runtime: "claude-code", model: "sonnet" };

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

describe("resolveSpawnSelection", () => {
  it("uses an explicit provider over the persona runtime", () => {
    expect(resolveSpawnSelection("copilot", "", persona)).toEqual({ runtime: "copilot", model: "sonnet" });
  });

  it("uses an explicit model id over the persona model", () => {
    expect(resolveSpawnSelection("", "opus", persona)).toEqual({ runtime: "claude-code", model: "opus" });
  });

  it("overrides both when both are provided", () => {
    expect(resolveSpawnSelection("codex", "o3", persona)).toEqual({ runtime: "codex", model: "o3" });
  });

  it("falls back to the persona when neither is provided", () => {
    expect(resolveSpawnSelection("", "", persona)).toEqual({ runtime: "claude-code", model: "sonnet" });
  });
});

describe("buildPowerlineSpawnRequest", () => {
  it("plumbs task_id from config (no longer hardcoded empty)", () => {
    const config = create(grackle.SessionConfigSchema, { taskId: "task-42", branch: "feat", pipe: "async" });
    const req = buildPowerlineSpawnRequest({ ...serverInputs, config });

    expect(req.taskId).toBe("task-42");
    expect(req.branch).toBe("feat");
    expect(req.pipe).toBe("async");
  });

  it("passes use_worktrees=false through explicitly", () => {
    const config = create(grackle.SessionConfigSchema, { useWorktrees: false });
    expect(buildPowerlineSpawnRequest({ ...serverInputs, config }).useWorktrees).toBe(false);
  });

  it("passes use_worktrees=true through explicitly", () => {
    const config = create(grackle.SessionConfigSchema, { useWorktrees: true });
    expect(buildPowerlineSpawnRequest({ ...serverInputs, config }).useWorktrees).toBe(true);
  });

  it("leaves use_worktrees unset when config omits it (host default applies)", () => {
    const config = create(grackle.SessionConfigSchema, {});
    expect(buildPowerlineSpawnRequest({ ...serverInputs, config }).useWorktrees).toBeUndefined();
  });

  it("defaults cleanly when config is undefined", () => {
    const req = buildPowerlineSpawnRequest({ ...serverInputs, config: undefined });

    expect(req.taskId).toBe("");
    expect(req.branch).toBe("");
    expect(req.pipe).toBe("");
    expect(req.useWorktrees).toBeUndefined();
  });

  it("forwards server-resolved values verbatim", () => {
    const req = buildPowerlineSpawnRequest({ ...serverInputs, config: undefined });

    expect(req.sessionId).toBe("sess-1");
    expect(req.runtime).toBe("claude-code");
    expect(req.model).toBe("sonnet");
    expect(req.mcpToken).toBe("tok");
    expect(req.systemContext).toBe("ctx");
  });

  it("forwards a resolved workspaceId, leaving it unset when empty", () => {
    expect(buildPowerlineSpawnRequest({ ...serverInputs, workspaceId: "ws-1", config: undefined }).workspaceId).toBe("ws-1");
    expect(buildPowerlineSpawnRequest({ ...serverInputs, workspaceId: "", config: undefined }).workspaceId).toBeUndefined();
  });
});
