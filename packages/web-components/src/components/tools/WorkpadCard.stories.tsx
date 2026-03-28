import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { WorkpadCard } from "./WorkpadCard.js";

const meta: Meta<typeof WorkpadCard> = {
  component: WorkpadCard,
  title: "Tools/WorkpadCard",
};
export default meta;
type Story = StoryObj<typeof WorkpadCard>;

export const WriteInProgress: Story = {
  name: "workpad_write - in progress",
  args: {
    tool: "mcp__grackle__workpad_write",
    args: {
      status: "in_progress",
      summary: "Working on authentication refactor...",
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-workpad-status")).toHaveTextContent("in_progress");
    await expect(canvas.getByTestId("tool-card-workpad-summary")).toHaveTextContent("Working on authentication");
  },
};

export const WriteCompleted: Story = {
  name: "workpad_write - completed",
  args: {
    tool: "mcp__grackle__workpad_write",
    args: {
      status: "completed",
      summary: "Tested Grackle MCP tools",
    },
    result: JSON.stringify({
      taskId: "74f5b716",
      workpad: {
        status: "completed",
        summary: "Tested Grackle MCP tools: posted a finding, wrote to workpad, and searched knowledge.",
        extra: {
          tools_tested: ["finding_post", "workpad_write", "knowledge_search"],
          finding_topic: "qdrant catalog",
        },
      },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-workpad-status")).toHaveTextContent("completed");
    await expect(canvas.getByTestId("tool-card-workpad-summary")).toBeInTheDocument();
    // Extra data toggle should be present
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();
    // Expand to see extra data
    await userEvent.click(toggle);
    await expect(canvas.getByTestId("tool-card-workpad-extra")).toBeInTheDocument();
  },
};

export const ReadResult: Story = {
  name: "workpad_read - with data",
  args: {
    tool: "mcp__grackle__workpad_read",
    args: { taskId: "74f5b716" },
    result: JSON.stringify({
      status: "completed",
      summary: "All tests passing. PR ready for review.",
      extra: { pr_number: 142, branch: "feat/auth" },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-workpad-status")).toHaveTextContent("completed");
  },
};

export const CopilotFormat: Story = {
  name: "workpad_write - Copilot tool name",
  args: {
    tool: "grackle-workpad_write",
    args: { status: "in progress", summary: "Posted a finding about Rush worktrees." },
    result: JSON.stringify({
      taskId: "e4366a55",
      workpad: { status: "in progress", summary: "Posted a finding about Rush worktrees." },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
    await expect(canvas.getByText("workpad_write")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  name: "workpad_write - error",
  args: {
    tool: "mcp__grackle__workpad_write",
    args: { status: "done" },
    result: "gRPC error [FailedPrecondition]: no task context",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
