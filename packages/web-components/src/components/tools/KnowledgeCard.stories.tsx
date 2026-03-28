import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { KnowledgeCard } from "./KnowledgeCard.js";

const meta: Meta<typeof KnowledgeCard> = {
  component: KnowledgeCard,
  title: "Tools/KnowledgeCard",
};
export default meta;
type Story = StoryObj<typeof KnowledgeCard>;

export const SearchInProgress: Story = {
  name: "knowledge_search - in progress",
  args: {
    tool: "mcp__grackle__knowledge_search",
    args: { query: "authentication", limit: 5 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-knowledge-query")).toHaveTextContent("authentication");
  },
};

export const SearchWithResults: Story = {
  name: "knowledge_search - with results",
  args: {
    tool: "mcp__grackle__knowledge_search",
    args: { query: "authentication" },
    result: JSON.stringify({
      results: [
        { score: 0.92, node: { id: "n1", title: "Auth middleware design", category: "decision" } },
        { score: 0.85, node: { id: "n2", title: "Session token rotation", category: "insight" } },
        { score: 0.78, node: { id: "n3", title: "Pairing code auth flow", category: "reference" } },
      ],
      neighbors: [],
      neighborEdges: [],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-knowledge-count")).toHaveTextContent("3 results");
    await expect(canvas.getByTestId("tool-card-knowledge-results")).toBeInTheDocument();
  },
};

export const SearchEmpty: Story = {
  name: "knowledge_search - no results",
  args: {
    tool: "mcp__grackle__knowledge_search",
    args: { query: "nonexistent topic" },
    result: JSON.stringify({ results: [], neighbors: [], neighborEdges: [] }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-knowledge-count")).toHaveTextContent("0 results");
  },
};

export const GetNode: Story = {
  name: "knowledge_get_node - with edges",
  args: {
    tool: "mcp__grackle__knowledge_get_node",
    args: { id: "n1" },
    result: JSON.stringify({
      node: {
        id: "n1",
        title: "Auth middleware design",
        category: "decision",
        kind: "content",
        content: "The auth middleware uses pairing-code flow for web UI and Bearer token for gRPC.",
      },
      edges: [
        { fromId: "n1", toId: "n2", type: "RELATES_TO" },
        { fromId: "n1", toId: "n3", type: "DEPENDS_ON" },
      ],
      neighbors: [],
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-knowledge-id")).toHaveTextContent("n1");
    await expect(canvas.getByTestId("tool-card-knowledge-edges")).toHaveTextContent("2 edges");
    await expect(canvas.getByTestId("tool-card-knowledge-node")).toBeInTheDocument();
  },
};

export const CopilotFormat: Story = {
  name: "knowledge_search - Copilot tool name",
  args: {
    tool: "grackle-knowledge_search",
    args: { query: "authentication" },
    result: JSON.stringify({ results: [], neighbors: [], neighborEdges: [] }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByText("knowledge_search")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  name: "knowledge_search - error",
  args: {
    tool: "mcp__grackle__knowledge_search",
    args: { query: "test" },
    result: "UNAVAILABLE: knowledge service not running",
    isError: true,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("tool-card-knowledge")).toBeInTheDocument();
    await expect(canvas.getByTestId("tool-card-error")).toBeInTheDocument();
  },
};
