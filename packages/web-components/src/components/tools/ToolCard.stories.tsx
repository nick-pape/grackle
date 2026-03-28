import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { ToolCard } from "./ToolCard.js";

const meta: Meta<typeof ToolCard> = {
  component: ToolCard,
  title: "Grackle/Tools/ToolCard",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof meta>;

/** File read tool renders the file-read card variant. */
export const FileRead: Story = {
  args: {
    tool: "Read",
    args: { file_path: "/src/index.ts", limit: 50 },
    result: "import express from 'express';\n\nconst app = express();\napp.listen(3000);",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-file-read")).toBeInTheDocument();
    await expect(canvas.getByText("index.ts")).toBeInTheDocument();
  },
};

/** Shell command tool renders the shell card variant. */
export const ShellCommand: Story = {
  args: {
    tool: "Bash",
    args: { command: "npm test" },
    result: "[exit 0] All tests passed.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-shell")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-command")).toHaveTextContent("npm test");
  },
};

/** Unknown tool name falls through to the generic card. */
export const GenericTool: Story = {
  args: {
    tool: "MyCustomTool",
    args: { query: "search term" },
    result: "Found 3 results.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-generic")).toBeInTheDocument();
    await expect(canvas.getByText("MyCustomTool")).toBeInTheDocument();
  },
};

/** Claude Code Agent tool routes to the agent card. */
export const AgentTool: Story = {
  args: {
    tool: "Agent",
    args: { subagent_type: "Explore", description: "Find files", prompt: "Search for files." },
    result: "Found 5 files.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
  },
};

/** Copilot task tool routes to the agent card. */
export const CopilotTaskTool: Story = {
  args: {
    tool: "task",
    args: { agent_type: "explore", name: "search-task", prompt: "Search." },
    result: "Agent started.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
  },
};

/** Copilot read_agent tool routes to the agent card. */
export const CopilotReadAgentTool: Story = {
  args: {
    tool: "read_agent",
    args: { agent_id: "search-task" },
    result: "Agent completed. agent_id: search-task, status: completed, elapsed: 3s",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
  },
};
