import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { TaskCard } from "./TaskCard.js";

const meta: Meta<typeof TaskCard> = {
  component: TaskCard,
  title: "Tools/TaskCard",
};
export default meta;
type Story = StoryObj<typeof TaskCard>;

export const CreateInProgress: Story = {
  name: "task_create - in progress",
  args: {
    tool: "mcp__grackle__task_create",
    args: { title: "Fix authentication bug", description: "Session tokens not rotated" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-task-title")).toHaveTextContent("Fix authentication bug");
  },
};

export const CreateCompleted: Story = {
  name: "task_create - completed",
  args: {
    tool: "mcp__grackle__task_create",
    args: { title: "Fix authentication bug" },
    result: JSON.stringify({
      id: "74f5b716",
      title: "Fix authentication bug",
      status: "not_started",
      branch: "default/fix-authentication-bug",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-task-detail")).toBeInTheDocument();
  },
};

export const StartCompleted: Story = {
  name: "task_start - session spawned",
  args: {
    tool: "mcp__grackle__task_start",
    args: { taskId: "74f5b716" },
    result: JSON.stringify({
      sessionId: "1fec3be8-c4f6-423c-a071-9540b2663bc0",
      taskId: "74f5b716",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-task-session")).toHaveTextContent("1fec3be8");
  },
};

export const CompleteStatus: Story = {
  name: "task_complete - marked complete",
  args: {
    tool: "mcp__grackle__task_complete",
    args: { taskId: "74f5b716" },
    result: JSON.stringify({
      id: "74f5b716",
      title: "Fix authentication bug",
      status: "complete",
      branch: "default/fix-authentication-bug",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-task-status")).toBeInTheDocument();
  },
};

export const ListWithTasks: Story = {
  name: "task_list - multiple tasks",
  args: {
    tool: "mcp__grackle__task_list",
    args: {},
    result: JSON.stringify([
      { id: "t1", title: "Fix auth bug", status: "complete" },
      { id: "t2", title: "Add dark mode", status: "working" },
      { id: "t3", title: "Write tests", status: "not_started" },
      { id: "t4", title: "Update docs", status: "paused" },
      { id: "t5", title: "Refactor API", status: "failed" },
    ]),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-task-count")).toHaveTextContent("5 tasks");
    await expect(canvas.getByTestId("tool-card-task-list")).toBeInTheDocument();
  },
};

export const CopilotFormat: Story = {
  name: "task_list - Copilot tool name",
  args: {
    tool: "grackle-task_list",
    args: {},
    result: JSON.stringify([
      { id: "t1", title: "Test task", status: "working" },
    ]),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByText("task_list")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  name: "task_start - error",
  args: {
    tool: "mcp__grackle__task_start",
    args: { taskId: "invalid" },
    result: "gRPC error [NotFound]: task not found",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
