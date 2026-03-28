import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { FindingCard } from "./FindingCard.js";

const meta: Meta<typeof FindingCard> = {
  component: FindingCard,
  title: "Tools/FindingCard",
};
export default meta;
type Story = StoryObj<typeof FindingCard>;

export const PostInProgress: Story = {
  name: "finding_post - in progress",
  args: {
    tool: "mcp__grackle__finding_post",
    args: {
      title: "Auth middleware stores tokens insecurely",
      category: "bug",
      tags: ["security", "auth"],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-finding-title")).toHaveTextContent("Auth middleware");
    await expect(canvas.getByTestId("tool-card-finding-category")).toHaveTextContent("bug");
  },
};

export const PostCompleted: Story = {
  name: "finding_post - completed",
  args: {
    tool: "mcp__grackle__finding_post",
    args: {
      title: "Qdrant catalog naming convention",
      category: "insight",
      tags: ["search", "worktree", "qdrant"],
    },
    result: JSON.stringify({
      id: "589f1e83",
      workspaceId: "default",
      category: "insight",
      title: "Qdrant catalog naming convention",
      content: "The qdrant-search MCP server indexes the codebase under the catalog name \"grackle\". All worktrees share the same codebase, so every semantic search call must pass catalog: \"grackle\".",
      tags: ["search", "worktree", "qdrant"],
      createdAt: "2026-03-28 03:49:15",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-finding-category")).toHaveTextContent("insight");
    await expect(canvas.getByTestId("tool-card-finding-tags")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-finding-content")).toBeInTheDocument();
  },
};

export const PostCopilotFormat: Story = {
  name: "finding_post - Copilot tool name",
  args: {
    tool: "grackle-finding_post",
    args: {
      title: "Rush worktree usage",
      category: "insight",
      tags: ["workflow"],
    },
    result: JSON.stringify({
      id: "e7091ea6",
      category: "insight",
      title: "Rush worktree usage",
      content: "This codebase uses Rush worktrees for all feature development.",
      tags: ["workflow"],
      createdAt: "2026-03-28 03:53:07",
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    // Should show bare tool name, not the full prefixed name
    await expect(canvas.getByText("finding_post")).toBeInTheDocument();
  },
};

export const ListWithResults: Story = {
  name: "finding_list - multiple results",
  args: {
    tool: "mcp__grackle__finding_list",
    args: { limit: 20 },
    result: JSON.stringify([
      { id: "f1", category: "insight", title: "Qdrant catalog naming" },
      { id: "f2", category: "bug", title: "Auth token storage issue" },
      { id: "f3", category: "decision", title: "Use ConnectRPC over ws-bridge" },
    ]),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-finding-count")).toHaveTextContent("3 findings");
    await expect(canvas.getByTestId("tool-card-finding-list")).toBeInTheDocument();
  },
};

export const ListEmpty: Story = {
  name: "finding_list - no results",
  args: {
    tool: "mcp__grackle__finding_list",
    args: { category: "bug" },
    result: JSON.stringify([]),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-finding-count")).toHaveTextContent("0 findings");
  },
};

export const ErrorState: Story = {
  name: "finding_post - error",
  args: {
    tool: "mcp__grackle__finding_post",
    args: { title: "Test finding" },
    result: "gRPC error [Internal]: database connection failed",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-finding")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
