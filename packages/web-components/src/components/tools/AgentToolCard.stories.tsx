import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { AgentToolCard } from "./AgentToolCard.js";

const meta: Meta<typeof AgentToolCard> = {
  component: AgentToolCard,
  title: "Tools/AgentToolCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Claude Code - Agent tool
// ---------------------------------------------------------------------------

export const ClaudeCodeForeground: Story = {
  name: "Claude Code - foreground Explore agent",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "Explore",
      description: "Find all TypeScript files with runtime",
      prompt: "Search for all TypeScript (.ts and .tsx) files under any src directory that contain the word runtime. List the matching file paths.",
      model: "sonnet",
    },
    result: "Found 23 matching files:\n- packages/runtime-sdk/src/runtime.ts\n- packages/runtime-claude-code/src/claude-code.ts\n- packages/runtime-copilot/src/copilot.ts\n- packages/server/src/runtime-manager.ts",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-type")).toHaveTextContent("Explore");
    await expect(canvas.getByTestId("tool-card-agent-model")).toHaveTextContent("sonnet");
    await expect(canvas.getByTestId("tool-card-agent-description")).toHaveTextContent("Find all TypeScript files with runtime");
    await expect(canvas.getByTestId("tool-card-result")).toBeInTheDocument();
    // Should NOT have background indicator
    await expect(canvas.queryByTestId("tool-card-agent-background")).not.toBeInTheDocument();
  },
};

export const ClaudeCodeBackground: Story = {
  name: "Claude Code - background agent completed",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "general-purpose",
      description: "Research API options",
      prompt: "Research the available authentication methods for the GitHub API.",
      run_in_background: true,
      model: "opus",
    },
    result: "GitHub API supports three auth methods:\n1. Personal access tokens (PAT)\n2. GitHub App installation tokens\n3. OAuth app tokens",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent-type")).toHaveTextContent("general-purpose");
    await expect(canvas.getByTestId("tool-card-agent-model")).toHaveTextContent("opus");
    await expect(canvas.getByTestId("tool-card-agent-background")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-background")).toHaveTextContent("BG");
  },
};

export const ClaudeCodeInProgress: Story = {
  name: "Claude Code - in progress (foreground)",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "Explore",
      description: "Count .ts files in the project",
      prompt: "Count the total number of .ts files (not .tsx) in this project. Return just the count.",
    },
    // No result -- still running
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-pending")).toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-result")).not.toBeInTheDocument();
    // Card should be dimmed
    const card = canvas.getByTestId("tool-card-agent");
    await expect(card.className).toContain("inProgress");
  },
};

export const ClaudeCodeBackgroundInProgress: Story = {
  name: "Claude Code - in progress (background)",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "general-purpose",
      description: "Long running analysis",
      prompt: "Analyze the entire codebase for security vulnerabilities.",
      run_in_background: true,
    },
    // No result -- still running
  },
  play: async ({ canvas }) => {
    // Background agents show BG badge with pulsing dot, NOT the generic pending dot
    await expect(canvas.getByTestId("tool-card-agent-background")).toBeInTheDocument();
    await expect(canvas.queryByTestId("tool-card-pending")).not.toBeInTheDocument();
  },
};

export const ClaudeCodeError: Story = {
  name: "Claude Code - error result",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "general-purpose",
      description: "Fix the auth bug",
      prompt: "Find and fix the authentication bug in the login flow.",
    },
    result: "Error: Agent exceeded maximum turns (10). The task was not completed.",
    isError: true,
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-agent");
    await expect(card.className).toContain("cardRed");
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};

export const ClaudeCodeLongResult: Story = {
  name: "Claude Code - long result with expand/collapse",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "Explore",
      description: "List all package.json files",
      prompt: "Find every package.json in the repo.",
    },
    result: "packages/cli/package.json\npackages/common/package.json\npackages/core/package.json\npackages/mcp/package.json\npackages/server/package.json\npackages/web/package.json\npackages/web-components/package.json\npackages/runtime-sdk/package.json\npackages/runtime-claude-code/package.json\npackages/runtime-copilot/package.json",
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();
    await expect(toggle.textContent).toContain("5 more lines");

    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("collapse");

    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("more lines");
  },
};

export const ClaudeCodeResume: Story = {
  name: "Claude Code - resuming a prior agent",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "general-purpose",
      description: "Continue the auth investigation",
      prompt: "Pick up where you left off analyzing the auth flow.",
      resume: "a40b974b6929b2f4a",
    },
    result: "Resumed analysis. The root cause is a missing token refresh in the middleware.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent-description")).toHaveTextContent("Resuming: Continue the auth investigation");
  },
};

export const ClaudeCodePromptToggle: Story = {
  name: "Claude Code - prompt expand/collapse",
  args: {
    tool: "Agent",
    args: {
      subagent_type: "Explore",
      description: "Search for patterns",
      prompt: "This is a detailed prompt that describes exactly what the subagent should do. It includes multiple sentences and specific instructions.",
    },
    result: "Done.",
  },
  play: async ({ canvas }) => {
    // Prompt should be collapsed by default
    await expect(canvas.queryByTestId("tool-card-prompt")).not.toBeInTheDocument();

    // Click to expand
    const toggle = canvas.getByTestId("tool-card-prompt-toggle");
    await userEvent.click(toggle);
    await expect(canvas.getByTestId("tool-card-prompt")).toBeInTheDocument();

    // Click to collapse
    await userEvent.click(toggle);
    await expect(canvas.queryByTestId("tool-card-prompt")).not.toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Copilot - task tool
// ---------------------------------------------------------------------------

export const CopilotTask: Story = {
  name: "Copilot - background task agent",
  args: {
    tool: "task",
    args: {
      agent_type: "explore",
      description: "Searching for grackle in files",
      mode: "background",
      name: "find-grackle-files",
      prompt: "Search all files in the current directory and subdirectories for the word grackle. List the file paths containing matches.",
    },
    result: "Agent started in background with agent_id: find-grackle-files. You can use read_agent tool with this agent_id to check status and retrieve results.",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-type")).toHaveTextContent("explore");
    await expect(canvas.getByTestId("tool-card-agent-background")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-name")).toHaveTextContent("find-grackle-files");
  },
};

export const CopilotTaskInProgress: Story = {
  name: "Copilot - task in progress",
  args: {
    tool: "task",
    args: {
      agent_type: "worker",
      description: "Building the project",
      mode: "background",
      name: "build-task",
      prompt: "Run rush build and report any errors.",
    },
    // No result -- still running
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-agent");
    await expect(card.className).toContain("inProgress");
    await expect(canvas.getByTestId("tool-card-agent-background")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Copilot - read_agent tool
// ---------------------------------------------------------------------------

export const CopilotReadAgentCompleted: Story = {
  name: "Copilot - read_agent completed",
  args: {
    tool: "read_agent",
    args: { agent_id: "find-grackle-files" },
    result: "Agent completed. agent_id: find-grackle-files, agent_type: explore, status: completed, elapsed: 6s, total_turns: 0, duration: 4s\n\nFound 12 matching files:\npackages/cli/src/index.ts\npackages/server/src/index.ts\npackages/common/src/types.ts",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-status")).toBeInTheDocument();
    // Status should show "completed"
    const status = canvas.getByTestId("tool-card-agent-status");
    await expect(status.textContent).toContain("completed");
    // Agent ID should be displayed in header
    await expect(canvas.getByTestId("tool-card-agent-id")).toHaveTextContent("find-grackle-files");
    // Result content should be the part after the prefix
    await expect(canvas.getByTestId("tool-card-result")).toHaveTextContent(/Found 12 matching files/);
  },
};

export const CopilotReadAgentError: Story = {
  name: "Copilot - read_agent error",
  args: {
    tool: "read_agent",
    args: { agent_id: "failed-task" },
    result: "Agent failed. agent_id: failed-task, agent_type: worker, status: failed, elapsed: 30s\n\nThe agent encountered an unrecoverable error during execution.",
    isError: true,
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-agent");
    await expect(card.className).toContain("cardRed");
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};

export const CopilotReadAgentUnparseable: Story = {
  name: "Copilot - read_agent with unstructured result",
  args: {
    tool: "read_agent",
    args: { agent_id: "some-agent" },
    result: "The agent returned some plain text result without the structured prefix.",
  },
  play: async ({ canvas }) => {
    // Should gracefully fall back to showing raw result
    await expect(canvas.getByTestId("tool-card-result")).toHaveTextContent("The agent returned some plain text result");
    // No status line since it couldn't be parsed
    await expect(canvas.queryByTestId("tool-card-agent-status")).not.toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Legacy - Claude Code Task (old name)
// ---------------------------------------------------------------------------

export const LegacyTask: Story = {
  name: "Claude Code - legacy Task tool name",
  args: {
    tool: "Task",
    args: {
      subagent_type: "Explore",
      description: "Find test files",
      prompt: "List all test files in the project.",
    },
    result: "Found 42 test files across 8 packages.",
  },
  play: async ({ canvas }) => {
    // Should render as AgentToolCard, not GenericToolCard
    await expect(canvas.getByTestId("tool-card-agent")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-agent-type")).toHaveTextContent("Explore");
  },
};
