import { useCallback, useEffect, useMemo, type JSX, type MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useStoreApi,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Session, StreamData, StreamMessageData } from "../../hooks/types.js";
import { SESSION_STATUS_VAR_NAMES, sessionStatusStyle } from "../../utils/sessionStatus.js";
import {
  SESSION_NODE_TYPE,
  STREAM_NODE_TYPE,
  useCoordinationLayout,
  type CoordNodeData,
} from "./useCoordinationLayout.js";
import { SessionNode } from "./SessionNode.js";
import { StreamNode } from "./StreamNode.js";
import { MessageDotEdge } from "./MessageDotEdge.js";
import styles from "./CoordinationGraph.module.scss";

/** Fallback node color for the MiniMap when a CSS variable is unavailable. */
const MINIMAP_FALLBACK_COLOR: string = "#6b7a8d";

/**
 * Stable reference for fitView options. MUST be a module-level constant —
 * an inline `{{ padding: 0.2 }}` creates a new object every render, which
 * makes React Flow's StoreUpdater think the prop changed (strict ===),
 * triggering an infinite setState loop under React 19 (error #185).
 */
const FIT_VIEW_OPTIONS: { padding: number } = { padding: 0.2 };

/** Props for {@link CoordinationGraph}. */
export interface CoordinationGraphProps {
  /** Streams to visualize (already filtered for internals by the caller). */
  streams: StreamData[];
  /** All known sessions, used to resolve subscribers into nodes and colors. */
  sessions: Session[];
  /** Currently selected stream id (its hub node is highlighted). */
  selectedStreamId?: string;
  /** Called with a stream id when its hub node is clicked. */
  onSelectStream: (streamId: string) => void;
  /**
   * Live per-stream message buffers (ascending by seq). When a stream's newest
   * seq advances, its edges animate a message dot. Omit for a static graph.
   */
  recentMessages?: Record<string, StreamMessageData[]>;
  /** Resolved theme id; recomputes MiniMap colors when the theme changes. */
  resolvedThemeId: string;
}

/**
 * Defers node/edge store updates to a setTimeout(0) macrotask, fully outside
 * React's commit phase. No `nodes`/`edges` props are passed to `<ReactFlow>`
 * so StoreUpdater never calls setNodes. This avoids the "Maximum update depth
 * exceeded" (error #185) cascade that React Flow v12's Zustand store triggers
 * under React 19.
 */
function DeferredFlowUpdater({ nodes, edges }: { nodes: Node[]; edges: Edge[] }): JSX.Element {
  const store = useStoreApi();

  useEffect(() => {
    const id = window.setTimeout(() => {
      store.getState().setNodes(nodes);
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [nodes, store]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      store.getState().setEdges(edges);
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [edges, store]);

  return <></>;
}

/** Custom node type registry for the coordination graph. */
const nodeTypes: NodeTypes = {
  [SESSION_NODE_TYPE]: SessionNode,
  [STREAM_NODE_TYPE]: StreamNode,
};

/** Custom edge type registry — the animated message-dot edge. */
const edgeTypes: EdgeTypes = {
  messageDot: MessageDotEdge,
};

/**
 * Live bipartite network graph of agent sessions and IPC streams. Sessions and
 * stream "hubs" are dagre-laid-out (deterministic); two-party pipes collapse to
 * direct edges. Read-only ("watch") - clicking a hub selects its stream.
 */
export function CoordinationGraph({
  streams,
  sessions,
  selectedStreamId,
  onSelectStream,
  recentMessages,
  resolvedThemeId,
}: CoordinationGraphProps): JSX.Element {
  const layout = useCoordinationLayout(streams, sessions);

  // Stamp each edge with its stream's latest message seq. When that seq advances,
  // MessageDotEdge fires a one-shot dot; stamping by streamId fans the pulse out
  // across all of a stream's edges (writer -> hub and hub -> readers).
  const edges = useMemo(
    () =>
      layout.edges.map((edge) => {
        if (!edge.data) {
          return edge;
        }
        const seq = recentMessages?.[edge.data.streamId]?.at(-1)?.seq;
        return seq === undefined ? edge : { ...edge, data: { ...edge.data, pulseSeq: seq } };
      }),
    [layout.edges, recentMessages],
  );

  // Mark the selected stream hub so React Flow applies node selection styling.
  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => {
        const data = node.data as CoordNodeData;
        const selected = data.kind === "stream" && data.stream.id === selectedStreamId;
        return selected ? { ...node, selected: true } : node;
      }),
    [layout.nodes, selectedStreamId],
  );

  /** Theme-resolved colors for the session-status CSS vars (MiniMap needs concrete colors). */
  const resolvedStatusColors = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const colors: Record<string, string> = {};
    for (const varName of SESSION_STATUS_VAR_NAMES) {
      colors[varName] = style.getPropertyValue(varName).trim() || MINIMAP_FALLBACK_COLOR;
    }
    return colors;
  }, [resolvedThemeId]);

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      const data = node.data as CoordNodeData;
      if (data.kind === "stream") {
        onSelectStream(data.stream.id);
      }
    },
    [onSelectStream],
  );

  const minimapNodeColor = useCallback(
    (node: Node): string => {
      const data = node.data as CoordNodeData;
      if (data.kind === "session") {
        return (
          resolvedStatusColors[sessionStatusStyle(data.session.status, data.external).varName] ??
          MINIMAP_FALLBACK_COLOR
        );
      }
      return MINIMAP_FALLBACK_COLOR;
    },
    [resolvedStatusColors],
  );

  if (layout.nodes.length === 0) {
    return (
      <div className={styles.empty} data-testid="coordination-graph-empty">
        No active streams to visualize
      </div>
    );
  }

  return (
    <div className={styles.graphContainer} data-testid="coordination-graph">
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        nodesConnectable={false}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.3}
        maxZoom={2}
      >
        <DeferredFlowUpdater nodes={nodes} edges={edges} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--text-disabled)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="var(--bg-overlay)"
          style={{ background: "var(--bg-inset)" }}
        />
      </ReactFlow>
    </div>
  );
}
