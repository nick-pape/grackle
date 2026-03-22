/**
 * Force-directed knowledge graph visualization using d3-force + SVG.
 *
 * Renders nodes as styled SVG elements with CSS theming support,
 * glassmorphic cards, glow effects, and smooth transitions.
 *
 * @module
 */

import { useCallback, useRef, useEffect, useState, type JSX } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import "d3-transition";
import type { GraphNode, GraphLink } from "../../hooks/useKnowledge.js";
import styles from "./KnowledgeGraph.module.scss";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum, GraphNode {}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Color map for node categories/types. */
const NODE_COLORS: Record<string, string> = {
  reference: "#4A9EFF",
  decision: "#22C55E",
  insight: "#EAB308",
  concept: "#A855F7",
  snippet: "#6B7280",
};

/** Get the display color for a node. */
function getNodeColor(node: GraphNode): string {
  if (node.kind === "reference") {
    return NODE_COLORS.reference;
  }
  return NODE_COLORS[node.category ?? "insight"] ?? NODE_COLORS.insight;
}

/** Node card dimensions. */
const NODE_WIDTH: number = 160;
const NODE_HEIGHT: number = 48;
const NODE_RADIUS: number = 12;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KnowledgeGraphProps {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNodeId?: string;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
}

/** Force-directed knowledge graph visualization with SVG rendering. */
export function KnowledgeGraph({
  graphData,
  selectedNodeId,
  onNodeClick,
  onNodeDoubleClick,
}: KnowledgeGraphProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | undefined>(undefined);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Track container size
  useEffect(() => {
    const container: HTMLElement | null = svgRef.current?.parentElement ?? null;
    if (!container) {
      return;
    }

    const observer: ResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    setDimensions({ width: container.clientWidth, height: container.clientHeight });

    return () => { observer.disconnect(); };
  }, []);

  // Setup zoom
  useEffect(() => {
    if (!svgRef.current || !gRef.current) {
      return;
    }

    const svgEl: SVGSVGElement = svgRef.current;
    const gEl: SVGGElement = gRef.current;

    const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        select(gEl).attr("transform", event.transform as string);
      });

    select(svgEl).call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    return () => {
      select(svgEl).on(".zoom", null);
    };
  }, []);

  // Run simulation
  useEffect(() => {
    if (graphData.nodes.length === 0) {
      if (simRef.current) {
        simRef.current.stop();
        simRef.current = undefined;
      }
      return;
    }

    // Clone data for d3 mutation
    const simNodes: SimNode[] = graphData.nodes.map((n) => ({ ...n }));
    const nodeMap: Map<string, SimNode> = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = graphData.links
      .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map((l) => ({
        source: l.source,
        target: l.target,
        type: l.type,
      }));

    // Stop previous simulation
    if (simRef.current) {
      simRef.current.stop();
    }

    const sim: Simulation<SimNode, SimLink> = forceSimulation(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(120))
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", forceCollide<SimNode>(NODE_WIDTH / 2 + 10))
      .on("tick", () => {
        if (!gRef.current) {
          return;
        }

        // Update link positions
        select(gRef.current)
          .selectAll<SVGLineElement, SimLink>(".knowledge-link")
          .data(simLinks, (d: SimLink) => `${(d.source as SimNode).id}:${(d.target as SimNode).id}`)
          .attr("x1", (d: SimLink) => (d.source as SimNode).x ?? 0)
          .attr("y1", (d: SimLink) => (d.source as SimNode).y ?? 0)
          .attr("x2", (d: SimLink) => (d.target as SimNode).x ?? 0)
          .attr("y2", (d: SimLink) => (d.target as SimNode).y ?? 0);

        // Update node positions
        select(gRef.current)
          .selectAll<SVGGElement, SimNode>(".knowledge-node")
          .data(simNodes, (d: SimNode) => d.id)
          .attr("transform", (d: SimNode) =>
            `translate(${(d.x ?? 0) - NODE_WIDTH / 2},${(d.y ?? 0) - NODE_HEIGHT / 2})`
          );
      });

    simRef.current = sim;

    // Render links
    const linkSelection = select(gRef.current!)
      .selectAll<SVGLineElement, SimLink>(".knowledge-link")
      .data(simLinks, (d: SimLink) => `${String((d.source as SimNode).id)}:${String((d.target as SimNode).id)}`);

    linkSelection.exit().remove();

    linkSelection.enter()
      .append("line")
      .attr("class", `knowledge-link ${styles.link}`);

    // Render nodes
    const nodeSelection = select(gRef.current!)
      .selectAll<SVGGElement, SimNode>(".knowledge-node")
      .data(simNodes, (d: SimNode) => d.id);

    nodeSelection.exit().remove();

    const nodeEnter: Selection<SVGGElement, SimNode, SVGGElement, unknown> = nodeSelection.enter()
      .append("g")
      .attr("class", (d: SimNode) => {
        const classes: string[] = [`knowledge-node`, styles.node];
        if (d.id === selectedNodeId) {
          classes.push(styles.selected);
        }
        return classes.join(" ");
      })
      .on("click", (_event: MouseEvent, d: SimNode) => {
        onNodeClick(d.id);
      })
      .on("dblclick", (_event: MouseEvent, d: SimNode) => {
        onNodeDoubleClick(d.id);
      });

    // Node card background
    nodeEnter.append("rect")
      .attr("class", styles.nodeCard)
      .attr("width", NODE_WIDTH)
      .attr("height", NODE_HEIGHT)
      .attr("rx", NODE_RADIUS)
      .attr("ry", NODE_RADIUS)
      .style("--node-color", (d: SimNode) => getNodeColor(d));

    // Category indicator bar
    nodeEnter.append("rect")
      .attr("class", styles.nodeIndicator)
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", 4)
      .attr("height", NODE_HEIGHT)
      .attr("rx", 2)
      .attr("fill", (d: SimNode) => getNodeColor(d));

    // Node label
    nodeEnter.append("text")
      .attr("class", styles.nodeLabel)
      .attr("x", NODE_WIDTH / 2)
      .attr("y", NODE_HEIGHT / 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .text((d: SimNode) => {
        const label: string = d.label;
        return label.length > 20 ? label.substring(0, 18) + "..." : label;
      });

    // Category badge
    nodeEnter.append("text")
      .attr("class", styles.nodeBadge)
      .attr("x", NODE_WIDTH / 2)
      .attr("y", NODE_HEIGHT - 6)
      .attr("text-anchor", "middle")
      .text((d: SimNode) => d.kind === "reference" ? d.sourceType ?? "ref" : d.category ?? "");

    // Fit to view after simulation settles
    const fitTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (svgRef.current && zoomRef.current) {
        const zb: ZoomBehavior<SVGSVGElement, unknown> = zoomRef.current;
        const t = zoomIdentity
          .translate(dimensions.width / 2, dimensions.height / 2)
          .scale(0.8)
          .translate(-dimensions.width / 2, -dimensions.height / 2);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- d3 zoom API requires this pattern
        select(svgRef.current).transition().duration(500).call(zb.transform, t);
      }
    }, 1000);

    return () => {
      clearTimeout(fitTimer);
      sim.stop();
    };
  }, [graphData, dimensions, selectedNodeId, onNodeClick, onNodeDoubleClick]);

  // Center on selected node
  const handleCenterOnNode = useCallback(() => {
    if (!selectedNodeId || !simRef.current || !svgRef.current || !zoomRef.current) {
      return;
    }
    const node: SimNode | undefined = simRef.current.nodes().find((n: SimNode) => n.id === selectedNodeId);
    if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) {
      const zb: ZoomBehavior<SVGSVGElement, unknown> = zoomRef.current;
      const t = zoomIdentity
        .translate(dimensions.width / 2, dimensions.height / 2)
        .scale(1.2)
        .translate(-(node.x ?? 0), -(node.y ?? 0));
      // eslint-disable-next-line @typescript-eslint/unbound-method -- d3 zoom API requires this pattern
      select(svgRef.current).transition().duration(500).call(zb.transform, t);
    }
  }, [selectedNodeId, dimensions]);

  useEffect(() => {
    handleCenterOnNode();
  }, [handleCenterOnNode]);

  return (
    <div className={styles.graphContainer} data-testid="knowledge-graph">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className={styles.svg}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g ref={gRef} />
      </svg>
    </div>
  );
}
