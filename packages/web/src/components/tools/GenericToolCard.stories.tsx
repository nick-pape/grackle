import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { GenericToolCard } from "./GenericToolCard.js";

const meta: Meta<typeof GenericToolCard> = {
  component: GenericToolCard,
  title: "Tools/GenericToolCard",
};
export default meta;
type Story = StoryObj<typeof meta>;

export const McpTool: Story = {
  name: "MCP tool - formatted name",
  args: {
    tool: "mcp__github__create_pull_request",
    args: { title: "Add auth middleware", base: "main", head: "feat/auth" },
    result: "PR #142 created successfully",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-generic")).toBeInTheDocument();
    // MCP name should be formatted as "server / tool"
    await expect(canvas.getByText("github / create_pull_request")).toBeInTheDocument();
  },
};

export const UnknownTool: Story = {
  name: "Unknown tool",
  args: {
    tool: "custom_tool",
    args: { query: "find all TODOs" },
    result: "Found 12 TODO comments across 5 files",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("custom_tool")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-result")).toHaveTextContent("Found 12 TODO comments");
  },
};

export const InProgress: Story = {
  name: "In-progress - shows formatted args",
  args: {
    tool: "WebFetch",
    args: { url: "https://api.example.com/data" },
  },
  play: async ({ canvas }) => {
    const card = canvas.getByTestId("tool-card-generic");
    await expect(card.className).toContain("inProgress");
    await expect(canvas.getByTestId("tool-card-args")).toBeInTheDocument();
  },
};

export const LongResult: Story = {
  name: "Long result - expand/collapse",
  args: {
    tool: "WebSearch",
    args: { query: "nodejs best practices 2026" },
    result: "Result 1: Use ESM modules\nResult 2: Adopt Node 22\nResult 3: Use built-in test runner\nResult 4: Prefer fetch over axios\nResult 5: Use structured logging\nResult 6: Type-check with tsc\nResult 7: Use Biome for formatting\nResult 8: Pin dependency versions",
  },
  play: async ({ canvas }) => {
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(toggle.textContent).toContain("collapse");
  },
};

export const ErrorResult: Story = {
  args: {
    tool: "mcp__slack__send_message",
    args: { channel: "#deploys", message: "Deployed v2.0" },
    result: "Error: channel not found",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
    const card = canvas.getByTestId("tool-card-generic");
    await expect(card.className).toContain("cardRed");
  },
};
