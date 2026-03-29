import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, fireEvent, waitFor } from "@storybook/test";
import type { GraphNode } from "../../hooks/types.js";
import { makeGraphNode, makeGraphLink } from "../../test-utils/storybook-helpers.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";

const nodeA: GraphNode = makeGraphNode({ id: "n-1", label: "Auth Flow", category: "concept" });
const nodeB: GraphNode = makeGraphNode({ id: "n-2", label: "DB Schema", category: "decision" });
const nodeC: GraphNode = makeGraphNode({ id: "n-3", label: "Perf Insight", category: "insight" });

const meta: Meta<typeof KnowledgeGraph> = {
  title: "Grackle/Knowledge/KnowledgeGraph",
  tags: ["autodocs"],
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
    // Wait for D3 to render and selection classes to be applied (separate effect)
    await waitFor(async () => {
      const nodeGroups = container.querySelectorAll("g.kg-node");
      await expect(nodeGroups.length).toBe(3);
      // At least one node should have a selection-related CSS class
      // (the exact class name is from CSS modules, so check that classes differ)
      const classLists = Array.from(nodeGroups).map((g) => g.getAttribute("class") ?? "");
      // Selected node (n-1) and connected node (n-2) should differ from unconnected node (n-3)
      const uniqueClasses = new Set(classLists);
      await expect(uniqueClasses.size).toBeGreaterThan(1);
    }, { timeout: 3000 });
  },
};

/** Dragging a node updates its position in the graph. */
export const DraggableNodes: Story = {
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

    // Wait for D3 force simulation to create and position nodes
    let targetNode!: Element;
    await waitFor(async () => {
      const nodeGroups = container.querySelectorAll("g.kg-node");
      await expect(nodeGroups.length).toBe(3);
      targetNode = nodeGroups[0];
      // Node should have a transform set by the simulation
      const transform = targetNode.getAttribute("transform");
      await expect(transform).not.toBeNull();
    }, { timeout: 3000 });

    const beforeTransform = targetNode.getAttribute("transform");

    // Simulate a drag: mousedown -> mousemove (large offset) -> mouseup
    await fireEvent.mouseDown(targetNode, { clientX: 100, clientY: 100 });
    await fireEvent.mouseMove(targetNode, { clientX: 250, clientY: 250 });
    await fireEvent.mouseUp(targetNode, { clientX: 250, clientY: 250 });

    // Wait a tick for simulation to update positions
    await waitFor(async () => {
      const afterTransform = targetNode.getAttribute("transform");
      await expect(afterTransform).not.toBe(beforeTransform);
    }, { timeout: 3000 });
  },
};

/** Dragging a node more than 3px does NOT fire onNodeClick. */
export const DragDoesNotTriggerClick: Story = {
  args: {
    graphData: {
      nodes: [nodeA, nodeB],
      links: [
        makeGraphLink({ source: "n-1", target: "n-2", type: "relates_to" }),
      ],
    },
    onNodeClick: fn(),
  },
  play: async ({ canvas, args }) => {
    const container = canvas.getByTestId("knowledge-graph");

    let targetNode!: Element;
    await waitFor(async () => {
      const nodeGroups = container.querySelectorAll("g.kg-node");
      await expect(nodeGroups.length).toBe(2);
      targetNode = nodeGroups[0];
    }, { timeout: 3000 });

    // Simulate a drag that moves more than the click threshold
    await fireEvent.mouseDown(targetNode, { clientX: 100, clientY: 100 });
    await fireEvent.mouseMove(targetNode, { clientX: 120, clientY: 120 });
    await fireEvent.mouseUp(targetNode, { clientX: 120, clientY: 120 });

    // onClick should NOT have been called since the mouse moved >3px
    await expect(args.onNodeClick).not.toHaveBeenCalled();
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
