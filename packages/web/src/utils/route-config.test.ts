import { describe, it, expect } from "vitest";
import {
  sessionUrl,
  workspaceUrl,
  taskUrl,
  taskEditUrl,
  newTaskUrl,
  newChatUrl,
  SETTINGS_URL,
  PERSONAS_URL,
  NEW_ENVIRONMENT_URL,
} from "./navigation.js";

describe("URL builder functions", () => {
  it("sessionUrl encodes sessionId", () => {
    expect(sessionUrl("abc-123")).toBe("/sessions/abc-123");
    expect(sessionUrl("has space")).toBe("/sessions/has%20space");
    expect(sessionUrl("special/chars")).toBe("/sessions/special%2Fchars");
  });

  it("workspaceUrl encodes workspaceId", () => {
    expect(workspaceUrl("proj-1")).toBe("/workspaces/proj-1");
    expect(workspaceUrl("proj with space")).toBe("/workspaces/proj%20with%20space");
  });

  it("taskUrl without tab produces base path", () => {
    expect(taskUrl("task-1")).toBe("/tasks/task-1");
  });

  it("taskUrl with stream tab produces correct path", () => {
    expect(taskUrl("task-1", "stream")).toBe("/tasks/task-1/stream");
  });

  it("taskUrl with findings tab produces correct path", () => {
    expect(taskUrl("task-1", "findings")).toBe("/tasks/task-1/findings");
  });

  it("taskUrl encodes taskId", () => {
    expect(taskUrl("has space")).toBe("/tasks/has%20space");
    expect(taskUrl("has space", "stream")).toBe("/tasks/has%20space/stream");
  });

  it("taskEditUrl produces correct path", () => {
    expect(taskEditUrl("task-1")).toBe("/tasks/task-1/edit");
  });

  it("newTaskUrl with no params produces base path", () => {
    expect(newTaskUrl()).toBe("/tasks/new");
  });

  it("newTaskUrl includes workspace param", () => {
    expect(newTaskUrl("proj-1")).toBe("/tasks/new?workspace=proj-1");
  });

  it("newTaskUrl includes workspace and parent params", () => {
    const url = newTaskUrl("proj-1", "parent-task");
    expect(url).toBe("/tasks/new?workspace=proj-1&parent=parent-task");
  });

  it("newChatUrl includes env param", () => {
    const url = newChatUrl("env-1");
    expect(url).toBe("/sessions/new?env=env-1");
  });

  it("constant URLs are correct", () => {
    expect(SETTINGS_URL).toBe("/settings");
    expect(PERSONAS_URL).toBe("/settings/personas");
    expect(NEW_ENVIRONMENT_URL).toBe("/environments/new");
  });
});
