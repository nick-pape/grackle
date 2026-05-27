/**
 * Dagre positioning layer for the Coordination graph. Takes the pure
 * {@link buildCoordinationGraph} model (dagre-free, unit-testable) and assigns
 * deterministic node positions via a left-to-right bipartite dagre layout.
 *
 * @module
 */

import { useMemo } from "react";
import dagre from "@dagrejs/dagre";
import type { Node } from "@xyflow/react";
import type { Session, StreamData } from "../../hooks/types.js";
import {
  buildCoordinationGraph,
  STREAM_NODE_TYPE,
  type CoordNodeData,
  type CoordinationLayoutResult,
} from "./coordinationGraphModel.js";

export {
  buildCoordinationGraph,
  sessionNodeId,
  streamNodeId,
  COORD_EDGE_TYPE,
  SESSION_NODE_TYPE,
  STREAM_NODE_TYPE,
} from "./coordinationGraphModel.js";
export type {
  CoordEdgeData,
  CoordNodeData,
  CoordinationLayoutResult,
  SessionNodeData,
  StreamNodeData,
} from "./coordinationGraphModel.js";

/** Width of a session node (pixels). */
const SESSION_NODE_WIDTH: number = 200;
/** Height of a session node (pixels). */
const SESSION_NODE_HEIGHT: number = 64;
/** Width of a stream hub node (pixels). */
const STREAM_NODE_WIDTH: number = 180;
/** Height of a stream hub node (pixels). */
const STREAM_NODE_HEIGHT: number = 56;
/** Separation between sibling nodes within a rank (pixels). */
const NODE_SEPARATION: number = 40;
/** Separation between rank levels (pixels). */
const RANK_SEPARATION: number = 70;

/** Node dimensions for dagre, keyed by node type. */
function nodeDimensions(type: string | undefined): { width: number; height: number } {
  if (type === STREAM_NODE_TYPE) {
    return { width: STREAM_NODE_WIDTH, height: STREAM_NODE_HEIGHT };
  }
  return { width: SESSION_NODE_WIDTH, height: SESSION_NODE_HEIGHT };
}

/** Assign dagre positions to a pure coordination graph model. */
function layoutGraph(model: CoordinationLayoutResult): CoordinationLayoutResult {
  if (model.nodes.length === 0) {
    return model;
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: NODE_SEPARATION, ranksep: RANK_SEPARATION });

  for (const node of model.nodes) {
    const { width, height } = nodeDimensions(node.type);
    graph.setNode(node.id, { width, height });
  }
  for (const edge of model.edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  dagre.layout(graph);

  const nodes: Node<CoordNodeData>[] = model.nodes.map((node) => {
    const pos = graph.node(node.id) as { x: number; y: number };
    const { width, height } = nodeDimensions(node.type);
    return { ...node, position: { x: pos.x - width / 2, y: pos.y - height / 2 } };
  });

  return { nodes, edges: model.edges };
}

/**
 * Build and lay out the coordination graph, memoized on its inputs. Sessions
 * with no visible streams are intentionally omitted — the graph shows
 * coordination, not the full session inventory.
 */
export function useCoordinationLayout(
  streams: StreamData[],
  sessions: Session[],
): CoordinationLayoutResult {
  return useMemo(() => layoutGraph(buildCoordinationGraph(streams, sessions)), [streams, sessions]);
}
