import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import { KnowledgeNav } from "./KnowledgeNav.js";
import { makeGraphNode, makeWorkspace } from "../../test-utils/storybook-helpers.js";

const meta: Meta<typeof KnowledgeNav> = {
  title: "Grackle/Knowledge/KnowledgeNav",
  tags: ["autodocs"],
  component: KnowledgeNav,
  decorators: [
    (Story) => (
      <div style={{ width: "280px", height: "500px", overflow: "auto" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    nodes: [],
    workspaces: [],
    loading: false,
    searchQuery: "",
    onSearch: fn(),
    onClearSearch: fn(),
    onSelectNode: fn(),
    onWorkspaceChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof KnowledgeNav>;

/** Empty state shows "Nodes (0)" and the search input. */
export const EmptyState: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("knowledge-search-input")).toBeInTheDocument();
    await expect(canvas.getByTestId("knowledge-nav")).toHaveTextContent("Nodes (0)");
  },
};

/** Node list renders labels with category badges for each kind. */
export const WithNodes: Story = {
  args: {
    nodes: [
      makeGraphNode({ id: "n-1", label: "Auth Flow", kind: "knowledge", category: "concept" }),
      makeGraphNode({ id: "n-2", label: "DB Schema Choice", kind: "knowledge", category: "decision" }),
      makeGraphNode({ id: "n-3", label: "Perf Insight", kind: "knowledge", category: "insight" }),
      makeGraphNode({ id: "n-4", label: "Login Bug", kind: "reference", sourceType: "task" }),
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("knowledge-nav")).toHaveTextContent("Nodes (4)");
    await expect(canvas.getByText("Auth Flow")).toBeInTheDocument();
    await expect(canvas.getByText("DB Schema Choice")).toBeInTheDocument();
    await expect(canvas.getByText("Perf Insight")).toBeInTheDocument();
    await expect(canvas.getByText("Login Bug")).toBeInTheDocument();
  },
};

/** Submitting the search form calls onSearch with the trimmed query. */
export const SearchSubmit: Story = {
  play: async ({ canvas, args }) => {
    const input = canvas.getByTestId("knowledge-search-input");
    await userEvent.type(input, "  OAuth flow  ");
    await userEvent.keyboard("{Enter}");
    await expect(args.onSearch).toHaveBeenCalledWith("OAuth flow");
  },
};

/** Clear search button appears when searchQuery is non-empty and calls onClearSearch. */
export const ClearSearchButton: Story = {
  args: {
    searchQuery: "active query",
  },
  play: async ({ canvas, args }) => {
    const clearButton = canvas.getByRole("button", { name: "Clear search" });
    await expect(clearButton).toBeInTheDocument();
    await userEvent.click(clearButton);
    await expect(args.onClearSearch).toHaveBeenCalled();
  },
};

/** Changing the workspace filter calls onWorkspaceChange with the selected ID. */
export const WorkspaceFilterChange: Story = {
  args: {
    workspaces: [
      makeWorkspace({ id: "ws-alpha", name: "Alpha Workspace" }),
      makeWorkspace({ id: "ws-beta", name: "Beta Workspace" }),
    ],
  },
  play: async ({ canvas, args }) => {
    const select = canvas.getByTestId("knowledge-workspace-filter");
    await userEvent.selectOptions(select, "ws-alpha");
    await expect(args.onWorkspaceChange).toHaveBeenCalledWith("ws-alpha");
  },
};

/** Clicking a node in the list calls onSelectNode with the correct ID. */
export const NodeClickCallsOnSelectNode: Story = {
  args: {
    nodes: [
      makeGraphNode({ id: "node-xyz", label: "Click Me" }),
    ],
  },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByText("Click Me"));
    await expect(args.onSelectNode).toHaveBeenCalledWith("node-xyz");
  },
};
