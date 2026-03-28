import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { ToolCard } from "./ToolCard.js";

const meta: Meta<typeof ToolCard> = {
  component: ToolCard,
  title: "Tools/ToolCard",
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

/** MCP finding tool (Claude Code format) routes to FindingCard. */
export const McpFinding: Story = {
  name: "MCP finding_post (Claude Code)",
  args: {
    tool: "mcp__grackle__finding_post",
    args: { title: "Test finding", category: "insight" },
    result: JSON.stringify({ id: "f1", title: "Test finding", category: "insight", tags: [] }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
  },
};

/** MCP finding tool (Copilot format) routes to FindingCard. */
export const McpFindingCopilot: Story = {
  name: "MCP finding_post (Copilot)",
  args: {
    tool: "grackle-finding_post",
    args: { title: "Copilot finding", category: "bug" },
    result: JSON.stringify({ id: "f2", title: "Copilot finding", category: "bug", tags: [] }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
  },
};

/** MCP task tool routes to TaskCard. */
export const McpTask: Story = {
  name: "MCP task_list",
  args: {
    tool: "mcp__grackle__task_list",
    args: {},
    result: JSON.stringify([{ id: "t1", title: "Test", status: "working" }]),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-task")).toBeInTheDocument();
  },
};

/** MCP workpad tool routes to WorkpadCard. */
export const McpWorkpad: Story = {
  name: "MCP workpad_write",
  args: {
    tool: "mcp__grackle__workpad_write",
    args: { status: "done", summary: "All done" },
    result: JSON.stringify({ taskId: "t1", workpad: { status: "done", summary: "All done" } }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-workpad")).toBeInTheDocument();
  },
};

/** MCP knowledge tool routes to KnowledgeCard. */
export const McpKnowledge: Story = {
  name: "MCP knowledge_search",
  args: {
    tool: "mcp__grackle__knowledge_search",
    args: { query: "auth" },
    result: JSON.stringify({ results: [], neighbors: [], neighborEdges: [] }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
  },
};

/** MCP IPC tool routes to IpcCard. */
export const McpIpc: Story = {
  name: "MCP ipc_spawn",
  args: {
    tool: "mcp__grackle__ipc_spawn",
    args: { prompt: "Run tests", pipe: "detach", environmentId: "local" },
    result: JSON.stringify({ sessionId: "sess-1" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-ipc")).toBeInTheDocument();
  },
};

/** ToolSearch routes to ToolSearchCard. */
export const ToolSearchRouting: Story = {
  name: "ToolSearch routing",
  args: {
    tool: "ToolSearch",
    args: { query: "select:Read,Write" },
    result: "Read: reads a file\nWrite: writes a file",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-tool-search")).toBeInTheDocument();
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
