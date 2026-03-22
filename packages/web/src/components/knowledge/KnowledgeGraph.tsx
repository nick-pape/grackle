/**
 * Force-directed graph visualization for the knowledge graph.
 *
 * Uses react-force-graph-2d to render nodes and edges with custom
 * colors, sizing, and interaction handlers.
 *
 * @module
 */

import { useCallback, useRef, useEffect, type JSX } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { GraphNode, GraphLink } from "../../hooks/useKnowledge.js";
import styles from "./KnowledgeGraph.module.scss";

/** Color map for node categories/types. */
const NODE_COLORS: Record<string, string> = {
  // Reference nodes
  reference: "#4A9EFF",
  // Native categories
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

interface KnowledgeGraphProps {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNodeId?: string;
  onNodeClick: (nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
}

/** Force-directed knowledge graph visualization. */
export function KnowledgeGraph({
  graphData,
  selectedNodeId,
  onNodeClick,
  onNodeDoubleClick,
}: KnowledgeGraphProps): JSX.Element {
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);

  // Center on selected node
  useEffect(() => {
    if (selectedNodeId && graphRef.current) {
      const node = graphData.nodes.find((n) => n.id === selectedNodeId);
      if (node) {
        graphRef.current.centerAt(
          (node as unknown as { x: number }).x,
          (node as unknown as { y: number }).y,
          500,
        );
      }
    }
  }, [selectedNodeId, graphData.nodes]);

  // Zoom to fit on initial load
  useEffect(() => {
    if (graphData.nodes.length > 0 && graphRef.current) {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        graphRef.current?.zoomToFit(400, 50);
      }, 500);
      return () => { clearTimeout(timer); };
    }
    return undefined;
  }, [graphData.nodes.length]);

  /** Custom node renderer with labels. */
  const drawNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const radius = Math.sqrt(node.val || 1) * 4;
      const isSelected = node.id === selectedNodeId;
      const fontSize = 12 / globalScale;

      // Dim non-selected nodes when something is selected
      const alpha = selectedNodeId && !isSelected ? 0.2 : 1.0;

      ctx.globalAlpha = alpha;

      // Draw circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = getNodeColor(node);
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label
      if (globalScale > 0.5) {
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = alpha < 1 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.9)";
        ctx.fillText(node.label, x, y + radius + 2);
      }

      ctx.globalAlpha = 1;
    },
    [selectedNodeId],
  );

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onNodeClick(node.id);
    },
    [onNodeClick],
  );

  const handleNodeDblClick = useCallback(
    (node: GraphNode) => {
      onNodeDoubleClick(node.id);
    },
    [onNodeDoubleClick],
  );

  return (
    <div className={styles.graphContainer} data-testid="knowledge-graph">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={() => "replace"}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeDblClick}
        linkLabel={(link: GraphLink) => link.type}
        linkColor={() => "rgba(255,255,255,0.15)"}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        backgroundColor="transparent"
        warmupTicks={50}
        cooldownTicks={100}
      />
    </div>
  );
}
