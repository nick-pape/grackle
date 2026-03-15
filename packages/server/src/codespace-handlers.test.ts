import { describe, it, expect } from "vitest";
import { formatGhError } from "./ws-bridge.js";

describe("formatGhError", () => {
  it("returns friendly message for ENOENT (gh not found)", () => {
    const err = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    const result = formatGhError(err, "list codespaces");
    expect(result).toContain("gh");
    expect(result).toContain("PATH");
  });

  it("detects ENOENT from message when code is missing", () => {
    const err = new Error("spawn gh ENOENT");
    const result = formatGhError(err, "list codespaces");
    expect(result).toContain("gh");
    expect(result).toContain("PATH");
  });

  it("returns friendly message for EACCES", () => {
    const err = Object.assign(new Error("spawn gh EACCES"), {
      code: "EACCES",
    });
    const result = formatGhError(err, "list codespaces");
    expect(result).toContain("not executable");
    expect(result).toContain("permissions");
  });

  it("returns auth message when stderr contains 'auth'", () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: "gh auth login required",
    });
    const result = formatGhError(err, "list codespaces");
    expect(result).toContain("authenticated");
  });

  it("returns auth message when stderr contains 'login'", () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: "You must login first",
    });
    const result = formatGhError(err, "create codespace");
    expect(result).toContain("authenticated");
  });

  it("preserves stderr details for generic errors", () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: "connection timeout",
    });
    const result = formatGhError(err, "list codespaces");
    expect(result).toContain("connection timeout");
    expect(result).toContain("list codespaces");
  });

  it("handles undefined stderr without producing 'undefined' in output", () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: undefined,
    });
    const result = formatGhError(err, "list codespaces");
    expect(result).not.toContain("undefined");
    expect(result).toContain("command failed");
  });

  it("handles null stderr without producing 'null' in output", () => {
    const err = Object.assign(new Error("command failed"), { stderr: null });
    const result = formatGhError(err, "list codespaces");
    expect(result).not.toContain("null");
    expect(result).toContain("command failed");
  });

  it("falls back to message when no stderr", () => {
    const err = new Error("something broke");
    const result = formatGhError(err, "create codespace");
    expect(result).toContain("something broke");
    expect(result).toContain("create codespace");
  });
});
