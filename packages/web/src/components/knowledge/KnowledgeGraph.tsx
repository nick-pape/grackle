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

const NODE_COLORS: Record<string, string> = {
  reference: "#4A9EFF",
  decision: "#22C55E",
  insight: "#EAB308",
  concept: "#A855F7",
  snippet: "#6B7280",
};

function getNodeColor(node: GraphNode): string {
  if (node.kind === "reference") {
    return NODE_COLORS.reference;
  }
  return NODE_COLORS[node.category ?? "insight"] ?? NODE_COLORS.insight;
}

const NODE_WIDTH: number = 200;
const NODE_HEIGHT: number = 52;
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
  const linkElsRef = useRef<Selection<SVGLineElement, SimLink, SVGGElement, unknown> | undefined>(undefined);
  const nodeElsRef = useRef<Selection<SVGGElement, SimNode, SVGGElement, unknown> | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Track container size
  useEffect(() => {
    const container: HTMLElement | null = svgRef.current?.parentElement ?? null;
    if (!container) {
      return;
    }
    const observer: ResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
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
      .filter((event: Event) => {
        // Prevent zoom on double-click (we use it for expand)
        if (event.type === "dblclick") {
          return false;
        }
        return true;
      })
      .on("zoom", (event) => {
        select(gEl).attr("transform", String(event.transform));
      });

    select(svgEl).call(zoomBehavior);
    zoomRef.current = zoomBehavior;
    return () => { select(svgEl).on(".zoom", null); };
  }, []);

  // Stable callback refs so d3 event handlers don't go stale
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const onDblClickRef = useRef(onNodeDoubleClick);
  onDblClickRef.current = onNodeDoubleClick;

  // Run simulation
  useEffect(() => {
    if (!gRef.current) {
      return;
    }
    const g: SVGGElement = gRef.current;

    // Stop previous
    if (simRef.current) {
      simRef.current.stop();
      simRef.current = undefined;
    }

    if (graphData.nodes.length === 0) {
      select(g).selectAll("*").remove();
      return;
    }

    // Clone data for d3 mutation
    const simNodes: SimNode[] = graphData.nodes.map((n) => ({ ...n }));
    const nodeMap: Map<string, SimNode> = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = graphData.links
      .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, type: l.type }));

    // Clear previous elements
    select(g).selectAll("*").remove();

    // Create link elements
    const linkEls: Selection<SVGLineElement, SimLink, SVGGElement, unknown> = select(g)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks)
      .enter()
      .append("line")
      .attr("class", styles.link);

    // Edge type tooltip on hover
    linkEls.append("title")
      .text((d: SimLink) => d.type);

    linkElsRef.current = linkEls;

    // Create node groups
    const nodeEls: Selection<SVGGElement, SimNode, SVGGElement, unknown> = select(g)
      .selectAll<SVGGElement, SimNode>("g.kg-node")
      .data(simNodes)
      .enter()
      .append("g")
      .attr("class", `kg-node ${styles.node}`)
      .style("cursor", "pointer")
      .on("click", (_event: MouseEvent, d: SimNode) => {
        onClickRef.current(d.id);
      })
      .on("dblclick", (_event: MouseEvent, d: SimNode) => {
        onDblClickRef.current(d.id);
      });

    nodeElsRef.current = nodeEls;

    // Node card background
    nodeEls.append("rect")
      .attr("class", styles.nodeCard)
      .attr("width", NODE_WIDTH)
      .attr("height", NODE_HEIGHT)
      .attr("rx", NODE_RADIUS)
      .attr("ry", NODE_RADIUS)
      .style("--node-color", (d: SimNode) => getNodeColor(d));

    // Category indicator bar
    nodeEls.append("rect")
      .attr("class", styles.nodeIndicator)
      .attr("width", 4)
      .attr("height", NODE_HEIGHT)
      .attr("rx", 2)
      .attr("fill", (d: SimNode) => getNodeColor(d));

    // Node label
    nodeEls.append("text")
      .attr("class", styles.nodeLabel)
      .attr("x", NODE_WIDTH / 2)
      .attr("y", NODE_HEIGHT / 2 - 4)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .text((d: SimNode) => d.label.length > 26 ? d.label.substring(0, 24) + "..." : d.label);

    // Category badge
    nodeEls.append("text")
      .attr("class", styles.nodeBadge)
      .attr("x", NODE_WIDTH / 2)
      .attr("y", NODE_HEIGHT - 8)
      .attr("text-anchor", "middle")
      .text((d: SimNode) => (d.kind === "reference" ? d.sourceType ?? "ref" : d.category ?? "").toUpperCase());

    // Simulation
    const sim: Simulation<SimNode, SimLink> = forceSimulation(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(140))
      .force("charge", forceManyBody().strength(-400))
      .force("center", forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", forceCollide<SimNode>(NODE_WIDTH / 2 + 16))
      .on("tick", () => {
        linkEls
          .attr("x1", (d: SimLink) => (d.source as SimNode).x ?? 0)
          .attr("y1", (d: SimLink) => (d.source as SimNode).y ?? 0)
          .attr("x2", (d: SimLink) => (d.target as SimNode).x ?? 0)
          .attr("y2", (d: SimLink) => (d.target as SimNode).y ?? 0);

        nodeEls
          .attr("transform", (d: SimNode) =>
            `translate(${(d.x ?? 0) - NODE_WIDTH / 2},${(d.y ?? 0) - NODE_HEIGHT / 2})`
          );
      });

    simRef.current = sim;

    // Fit to view after simulation settles
    const fitTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (svgRef.current && zoomRef.current) {
        const zb: ZoomBehavior<SVGSVGElement, unknown> = zoomRef.current;
        const t = zoomIdentity
          .translate(dimensions.width / 2, dimensions.height / 2)
          .scale(0.8)
          .translate(-dimensions.width / 2, -dimensions.height / 2);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- d3 zoom API pattern
        select(svgRef.current).transition().duration(500).call(zb.transform, t);
      }
    }, 1200);

    return () => {
      clearTimeout(fitTimer);
      sim.stop();
    };
  }, [graphData, dimensions]);

  // Update selection styling without rebuilding simulation
  useEffect(() => {
    if (!gRef.current || !nodeElsRef.current || !linkElsRef.current) {
      return;
    }

    if (!selectedNodeId) {
      // No selection — full opacity on everything
      nodeElsRef.current.classed(styles.dimmed, false).classed(styles.selected, false);
      linkElsRef.current.classed(styles.dimmedLink, false);
      return;
    }

    // Build set of connected node IDs
    const connectedIds: Set<string> = new Set([selectedNodeId]);
    linkElsRef.current.each((d: SimLink) => {
      const srcId: string = (d.source as SimNode).id;
      const tgtId: string = (d.target as SimNode).id;
      if (srcId === selectedNodeId || tgtId === selectedNodeId) {
        connectedIds.add(srcId);
        connectedIds.add(tgtId);
      }
    });

    // Update node classes
    nodeElsRef.current
      .classed(styles.selected, (d: SimNode) => d.id === selectedNodeId)
      .classed(styles.dimmed, (d: SimNode) => !connectedIds.has(d.id));

    // Dim unconnected links
    linkElsRef.current
      .classed(styles.dimmedLink, (d: SimLink) => {
        const srcId: string = (d.source as SimNode).id;
        const tgtId: string = (d.target as SimNode).id;
        return !connectedIds.has(srcId) || !connectedIds.has(tgtId);
      });
  }, [selectedNodeId, graphData]);

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
      // eslint-disable-next-line @typescript-eslint/unbound-method -- d3 zoom API pattern
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
