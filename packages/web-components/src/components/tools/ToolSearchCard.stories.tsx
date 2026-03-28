import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "@storybook/test";
import { ToolSearchCard } from "./ToolSearchCard.js";

const meta: Meta<typeof ToolSearchCard> = {
  component: ToolSearchCard,
  title: "Tools/ToolSearchCard",
};
export default meta;
type Story = StoryObj<typeof ToolSearchCard>;

export const InProgress: Story = {
  name: "ToolSearch - in progress",
  args: {
    tool: "ToolSearch",
    args: { query: "select:mcp__grackle__finding_post,mcp__grackle__workpad_write", max_results: 3 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-tool-search")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-tool-search-query")).toBeInTheDocument();
  },
};

export const WithResults: Story = {
  name: "ToolSearch - with results",
  args: {
    tool: "ToolSearch",
    args: { query: "select:mcp__grackle__finding_post", max_results: 3 },
    result: [
      "mcp__grackle__finding_post:",
      "  Post a new finding to the workspace.",
      "  Parameters:",
      "    title (string, required): Finding title",
      "    category (string, optional): Category (bug, insight, decision)",
      "    content (string, optional): Detailed content",
      "    tags (array, optional): Tags for categorization",
      "",
      "mcp__grackle__workpad_write:",
      "  Write to the task workpad.",
      "  Parameters:",
      "    status (string, optional): Task status",
      "    summary (string, optional): Summary text",
    ].join("\n"),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-tool-search")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-tool-search-result")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-tool-search-count")).toBeInTheDocument();
  },
};

export const LongResultExpandable: Story = {
  name: "ToolSearch - long result with expand",
  args: {
    tool: "ToolSearch",
    args: { query: "grackle tools", max_results: 10 },
    result: Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: tool_${i + 1} definition`).join("\n"),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-tool-search")).toBeInTheDocument();
    const toggle = canvas.getByTestId("tool-card-toggle");
    await expect(toggle).toBeInTheDocument();
    await expect(toggle).toHaveTextContent("12 more lines");
    await userEvent.click(toggle);
    await expect(toggle).toHaveTextContent("collapse");
  },
};

export const ErrorState: Story = {
  name: "ToolSearch - error",
  args: {
    tool: "ToolSearch",
    args: { query: "nonexistent" },
    result: "No tools found matching query",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-tool-search")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
