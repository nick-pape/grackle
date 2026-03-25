import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "@storybook/test";
import type { GraphNode, NodeDetail } from "../../hooks/useKnowledge.js";
import { KnowledgeDetailPanel } from "./KnowledgeDetailPanel.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-001",
    label: "Authentication Flow",
    kind: "knowledge",
    category: "concept",
    content: "OAuth2 flow with PKCE for CLI clients.",
    tags: ["auth", "security"],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-02-20T14:30:00Z",
    val: 3,
    ...overrides,
  };
}

const connectedNodeA: GraphNode = makeGraphNode({
  id: "node-002",
  label: "Session Token Storage",
  category: "decision",
  val: 1,
});

const connectedNodeB: GraphNode = makeGraphNode({
  id: "node-003",
  label: "Token Rotation Policy",
  category: "insight",
  val: 2,
});

const unknownNodeId: string = "62d111f7-aaaa-bbbb-cccc-123456789abc";

const defaultNode: GraphNode = makeGraphNode();

const defaultDetail: NodeDetail = {
  node: defaultNode,
  edges: [
    { fromId: "node-001", toId: "node-002", type: "relates_to" },
    { fromId: "node-003", toId: "node-001", type: "derived_from" },
  ],
};

const allNodes: GraphNode[] = [defaultNode, connectedNodeA, connectedNodeB];

// ---------------------------------------------------------------------------
// Story meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof KnowledgeDetailPanel> = {
  title: "Knowledge/KnowledgeDetailPanel",
  component: KnowledgeDetailPanel,
  args: {
    detail: defaultDetail,
    nodes: allNodes,
    onClose: fn(),
    onSelectNode: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof KnowledgeDetailPanel>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/** Panel renders the node label, badge, content, tags, and timestamps. */
export const BasicRendering: Story = {
  play: async ({ canvas }) => {
    // Title
    await expect(canvas.getByText("Authentication Flow")).toBeInTheDocument();

    // Category badge
    await expect(canvas.getByText("concept")).toBeInTheDocument();

    // Content
    await expect(canvas.getByText("OAuth2 flow with PKCE for CLI clients.")).toBeInTheDocument();

    // Tags
    await expect(canvas.getByText("auth")).toBeInTheDocument();
    await expect(canvas.getByText("security")).toBeInTheDocument();

    // Timestamps
    await expect(canvas.getByText(/Created:/)).toBeInTheDocument();
    await expect(canvas.getByText(/Updated:/)).toBeInTheDocument();
  },
};

/** Edge links display connected node titles, not truncated UUIDs. */
export const EdgeLinksShowNodeTitles: Story = {
  play: async ({ canvas }) => {
    // Should show resolved titles, not truncated UUIDs
    await expect(canvas.getByText("Session Token Storage")).toBeInTheDocument();
    await expect(canvas.getByText("Token Rotation Policy")).toBeInTheDocument();

    // Edge types should be displayed
    const edgeTypes = canvas.getAllByTestId("edge-type");
    await expect(edgeTypes.length).toBe(2);
    await expect(edgeTypes[0]).toHaveTextContent("relates_to");
    await expect(edgeTypes[1]).toHaveTextContent("derived_from");
  },
};

/** Edge links fall back to truncated UUID when node is not in the graph. */
export const EdgeLinksFallbackToTruncatedId: Story = {
  args: {
    detail: {
      node: defaultNode,
      edges: [
        { fromId: "node-001", toId: unknownNodeId, type: "mentions" },
      ],
    },
    nodes: [defaultNode],
  },
  play: async ({ canvas }) => {
    // Should show truncated UUID since the connected node is not in the nodes list
    await expect(canvas.getByText("62d111f7...")).toBeInTheDocument();
  },
};

/** Clicking an edge link calls onSelectNode with the connected node ID. */
export const EdgeLinkClickCallsOnSelectNode: Story = {
  play: async ({ canvas, args }) => {
    const edgeLinks = canvas.getAllByTestId("edge-node-link");
    await userEvent.click(edgeLinks[0]);
    await expect(args.onSelectNode).toHaveBeenCalledWith("node-002");
  },
};

/** Close button calls onClose. */
export const CloseButtonCallsOnClose: Story = {
  play: async ({ canvas, args }) => {
    const closeButton = canvas.getByRole("button", { name: "Close" });
    await userEvent.click(closeButton);
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** No edges section when the node has no edges. */
export const NoEdges: Story = {
  args: {
    detail: {
      node: defaultNode,
      edges: [],
    },
  },
  play: async ({ canvas }) => {
    // Title should still render
    await expect(canvas.getByText("Authentication Flow")).toBeInTheDocument();

    // No "Edges" section label
    const panel = canvas.getByTestId("knowledge-detail-panel");
    await expect(panel.textContent).not.toContain("Edges (");
  },
};

/** Reference nodes show the "View in Grackle" link and a reference badge. */
export const ReferenceNode: Story = {
  args: {
    detail: {
      node: makeGraphNode({
        id: "ref-001",
        kind: "reference",
        sourceType: "task",
        sourceId: "task-123",
        label: "Fix login bug",
        content: undefined,
        tags: [],
      }),
      edges: [],
    },
    nodes: [],
  },
  play: async ({ canvas }) => {
    // Reference badge
    await expect(canvas.getByText("Reference (task)")).toBeInTheDocument();

    // View in Grackle link
    const viewLink = canvas.getByRole("button", { name: /View in Grackle/ });
    await expect(viewLink).toBeInTheDocument();
  },
};

/** Node without content or tags omits those sections. */
export const MinimalNode: Story = {
  args: {
    detail: {
      node: makeGraphNode({
        content: undefined,
        tags: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      }),
      edges: [],
    },
    nodes: [],
  },
  play: async ({ canvas }) => {
    // Title renders
    await expect(canvas.getByText("Authentication Flow")).toBeInTheDocument();

    // No Content or Tags sections
    const panel = canvas.getByTestId("knowledge-detail-panel");
    await expect(panel.textContent).not.toContain("Content");
    await expect(panel.textContent).not.toContain("Tags");
  },
};
