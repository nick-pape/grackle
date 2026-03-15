import { test, expect } from "@playwright/test";
import {
  sessionUrl,
  projectUrl,
  taskUrl,
  taskEditUrl,
  newTaskUrl,
  newChatUrl,
  SETTINGS_URL,
  PERSONAS_URL,
  NEW_ENVIRONMENT_URL,
} from "../src/utils/navigation.js";

test.describe("URL builder functions", () => {
  test("sessionUrl encodes sessionId", () => {
    expect(sessionUrl("abc-123")).toBe("/sessions/abc-123");
    expect(sessionUrl("has space")).toBe("/sessions/has%20space");
    expect(sessionUrl("special/chars")).toBe("/sessions/special%2Fchars");
  });

  test("projectUrl encodes projectId", () => {
    expect(projectUrl("proj-1")).toBe("/projects/proj-1");
    expect(projectUrl("proj with space")).toBe("/projects/proj%20with%20space");
  });

  test("taskUrl without tab produces base path", () => {
    expect(taskUrl("task-1")).toBe("/tasks/task-1");
  });

  test("taskUrl with stream tab produces correct path", () => {
    expect(taskUrl("task-1", "stream")).toBe("/tasks/task-1/stream");
  });

  test("taskUrl with findings tab produces correct path", () => {
    expect(taskUrl("task-1", "findings")).toBe("/tasks/task-1/findings");
  });

  test("taskUrl encodes taskId", () => {
    expect(taskUrl("has space")).toBe("/tasks/has%20space");
    expect(taskUrl("has space", "stream")).toBe("/tasks/has%20space/stream");
  });

  test("taskEditUrl produces correct path", () => {
    expect(taskEditUrl("task-1")).toBe("/tasks/task-1/edit");
  });

  test("newTaskUrl includes project param", () => {
    expect(newTaskUrl("proj-1")).toBe("/tasks/new?project=proj-1");
  });

  test("newTaskUrl includes project and parent params", () => {
    const url = newTaskUrl("proj-1", "parent-task");
    expect(url).toBe("/tasks/new?project=proj-1&parent=parent-task");
  });

  test("newChatUrl includes env and runtime params", () => {
    const url = newChatUrl("env-1", "claude-code");
    expect(url).toBe("/sessions/new?env=env-1&runtime=claude-code");
  });

  test("constant URLs are correct", () => {
    expect(SETTINGS_URL).toBe("/settings");
    expect(PERSONAS_URL).toBe("/settings/personas");
    expect(NEW_ENVIRONMENT_URL).toBe("/environments/new");
  });
});
