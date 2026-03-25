import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, waitFor } from "@storybook/test";
import type { GraphNode } from "../../hooks/useKnowledge.js";
import { makeGraphNode, makeGraphLink } from "../../test-utils/storybook-helpers.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";

const nodeA: GraphNode = makeGraphNode({ id: "n-1", label: "Auth Flow", category: "concept" });
const nodeB: GraphNode = makeGraphNode({ id: "n-2", label: "DB Schema", category: "decision" });
const nodeC: GraphNode = makeGraphNode({ id: "n-3", label: "Perf Insight", category: "insight" });

const meta: Meta<typeof KnowledgeGraph> = {
  title: "Knowledge/KnowledgeGraph",
  component: KnowledgeGraph,
  decorators: [
    (Story) => (
      <div style={{ width: "800px", height: "600px" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    graphData: { nodes: [], links: [] },
    onNodeClick: fn(),
    onNodeDoubleClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof KnowledgeGraph>;

/** Empty graph renders the container SVG with no node groups. */
export const EmptyGraph: Story = {
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("knowledge-graph");
    await expect(container).toBeInTheDocument();
    // D3 clears children when no nodes
    const svg = container.querySelector("svg");
    await expect(svg).not.toBeNull();
  },
};

/** Graph with nodes and links renders the correct number of SVG elements. */
export const WithNodesAndLinks: Story = {
  args: {
    graphData: {
      nodes: [nodeA, nodeB, nodeC],
      links: [
        makeGraphLink({ source: "n-1", target: "n-2", type: "relates_to" }),
        makeGraphLink({ source: "n-2", target: "n-3", type: "derived_from" }),
      ],
    },
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("knowledge-graph");
    // Wait for D3 force simulation to create SVG elements
    await waitFor(async () => {
      const nodeGroups = container.querySelectorAll("g.kg-node");
      await expect(nodeGroups.length).toBe(3);
    }, { timeout: 3000 });

    // Links should be rendered as <line> elements
    const lines = container.querySelectorAll("line");
    await expect(lines.length).toBe(2);

    // Node labels should appear as <text> elements
    const svg = container.querySelector("svg");
    await expect(svg?.textContent).toContain("Auth Flow");
    await expect(svg?.textContent).toContain("DB Schema");
    await expect(svg?.textContent).toContain("Perf Insight");
  },
};

/** Selected node gets highlighted with a CSS class. */
export const SelectedNodeHighlight: Story = {
  args: {
    graphData: {
      nodes: [nodeA, nodeB, nodeC],
      links: [
        makeGraphLink({ source: "n-1", target: "n-2", type: "relates_to" }),
      ],
    },
    selectedNodeId: "n-1",
  },
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("knowledge-graph");
    // Wait for D3 to render and selection classes to be applied
    await waitFor(async () => {
      const nodeGroups = container.querySelectorAll("g.kg-node");
      await expect(nodeGroups.length).toBe(3);
    }, { timeout: 3000 });

    // At least one node should have a selection-related CSS class
    // (the exact class name is from CSS modules, so check that classes differ)
    const nodeGroups = container.querySelectorAll("g.kg-node");
    const classLists = Array.from(nodeGroups).map((g) => g.getAttribute("class") ?? "");
    // Selected node (n-1) and connected node (n-2) should differ from unconnected node (n-3)
    const uniqueClasses = new Set(classLists);
    await expect(uniqueClasses.size).toBeGreaterThan(1);
  },
};

/** SVG element receives dimensions from the container. */
export const SVGDimensions: Story = {
  play: async ({ canvas }) => {
    const container = canvas.getByTestId("knowledge-graph");
    const svg = container.querySelector("svg");
    await expect(svg).not.toBeNull();
    if (svg) {
      const width = Number(svg.getAttribute("width"));
      const height = Number(svg.getAttribute("height"));
      await expect(width).toBeGreaterThan(0);
      await expect(height).toBeGreaterThan(0);
    }
  },
};
