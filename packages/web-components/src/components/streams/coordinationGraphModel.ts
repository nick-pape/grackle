/**
 * Pure bipartite graph model for the Coordination view: turns IPC streams and
 * sessions into React Flow nodes and edges (chatroom/channel hubs, collapsed
 * two-party pipes, edge direction from permission, external-session synthesis).
 *
 * No dagre and no React here — positions are placeholders, assigned later by
 * {@link useCoordinationLayout}. Keeping this layer dagre-free makes the graph
 * logic unit-testable (dagre's ESM build does not resolve under vitest).
 *
 * @module
 */

import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { Session, StreamData, StreamSubscriberData } from "../../hooks/types.js";
import { attributeStreamWithMap, streamKind, type StreamKind, type StreamOwnership } from "../../utils/streamCoordination.js";

/** React Flow node type id for session nodes. */
export const SESSION_NODE_TYPE: string = "session";
/** React Flow node type id for stream hub nodes. */
export const STREAM_NODE_TYPE: string = "stream";
/**
 * React Flow edge type id used for all coordination edges. In Phase A this is
 * the built-in `smoothstep`; Phase B swaps it for the animated `messageDot`.
 */
export const COORD_EDGE_TYPE: string = "smoothstep";

/** Data attached to a session node. */
export interface SessionNodeData extends Record<string, unknown> {
  kind: "session";
  /** The session, or a synthetic placeholder when the subscriber's session is unknown. */
  session: Session;
  /** Number of visible streams this session participates in. */
  streamCount: number;
  /** True when synthesized from a subscriber id not present in the sessions list (CLI/MCP). */
  external: boolean;
}

/** Data attached to a stream hub node. */
export interface StreamNodeData extends Record<string, unknown> {
  kind: "stream";
  stream: StreamData;
  /**
   * Display kind. Two-party pipes are collapsed into a direct edge and never
   * become hubs; a `pipe` stream that cannot collapse (e.g. not exactly two
   * distinct sessions) still renders as a hub with kind `pipe`.
   */
  streamKind: StreamKind;
  /** Ownership classification, used to decide whether the hub renders a task halo. */
  ownership: StreamOwnership;
}

/** Union of node data shapes carried on the coordination graph. */
export type CoordNodeData = SessionNodeData | StreamNodeData;

/** Data attached to a coordination edge. */
export interface CoordEdgeData extends Record<string, unknown> {
  /** `participation` = session<->hub subscription; `pipe` = collapsed 2-party pipe. */
  edgeKind: "participation" | "pipe";
  /** The stream this edge represents (the hub stream, or the collapsed pipe). */
  streamId: string;
  /** Subscriber permission ("r" | "w" | "rw") for participation edges. */
  permission: string;
  /** Delivery mode ("sync" | "async" | "detach"). */
  deliveryMode: string;
  /**
   * Transient pulse key, stamped by the graph when a new message arrives so the
   * animated edge fires a one-shot dot (Phase B). Undefined otherwise.
   */
  pulseSeq?: string;
}

/** Nodes and edges for the coordination graph (positions assigned by the layout step). */
export interface CoordinationLayoutResult {
  nodes: Node<CoordNodeData>[];
  edges: Edge<CoordEdgeData>[];
}

/** Prefix a session id to form its unique React Flow / dagre node id. */
export function sessionNodeId(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Prefix a stream id to form its unique React Flow / dagre node id. */
export function streamNodeId(streamId: string): string {
  return `stream:${streamId}`;
}

/** Minimal placeholder session for a subscriber whose session is not in the list. */
function syntheticSession(sessionId: string): Session {
  return { id: sessionId, environmentId: "", runtime: "external", status: "external", prompt: "", startedAt: "" };
}

/** Edge stroke style derived from delivery mode (detach reads as dashed + dimmed). */
function deliveryStyle(deliveryMode: string, stroke: string): Record<string, string | number> {
  if (deliveryMode === "detach") {
    return { stroke, strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.6 };
  }
  return { stroke, strokeWidth: 1.5 };
}

/** Resolve a collapsed pipe's direction (writer -> reader subscriber), or mark it bidirectional. */
function resolvePipeDirection(
  a: StreamSubscriberData,
  b: StreamSubscriberData,
): { source: StreamSubscriberData; target: StreamSubscriberData; bidirectional: boolean } {
  const aWrites = a.permission.includes("w");
  const bWrites = b.permission.includes("w");
  const aReads = a.permission.includes("r");
  const bReads = b.permission.includes("r");
  if (aWrites && !bWrites && bReads) {
    return { source: a, target: b, bidirectional: false };
  }
  if (bWrites && !aWrites && aReads) {
    return { source: b, target: a, bidirectional: false };
  }
  // Ambiguous (both rw, both w, etc.) — pick a deterministic order, no direction.
  const ordered = [a, b].sort((x, y) => x.sessionId.localeCompare(y.sessionId));
  return { source: ordered[0], target: ordered[1], bidirectional: true };
}

/**
 * Build the bipartite coordination graph (nodes + edges) from streams and
 * sessions. Node positions are placeholders ({@link useCoordinationLayout} runs
 * dagre to assign real positions). Sessions with no visible streams are omitted.
 *
 * `showInternals` filtering is the caller's responsibility — the streams passed
 * in are assumed already filtered (the page calls `loadStreams(includeInternal)`).
 */
export function buildCoordinationGraph(streams: StreamData[], sessions: Session[]): CoordinationLayoutResult {
  if (streams.length === 0) {
    return { nodes: [], edges: [] };
  }

  const sessionsById = new Map(sessions.map((s) => [s.id, s]));
  const sessionNodeData = new Map<string, SessionNodeData>();
  const streamNodeData = new Map<string, StreamNodeData>();
  const edges: Edge<CoordEdgeData>[] = [];

  /** Register a session node once, returning its (mutable) data. */
  const ensureSessionNode = (sessionId: string): SessionNodeData => {
    let data = sessionNodeData.get(sessionId);
    if (!data) {
      const session = sessionsById.get(sessionId);
      data = {
        kind: "session",
        session: session ?? syntheticSession(sessionId),
        streamCount: 0,
        external: session === undefined,
      };
      sessionNodeData.set(sessionId, data);
    }
    return data;
  };

  for (const stream of streams) {
    const kind = streamKind(stream);

    // Collapse a 2-party pipe into a single direct session->session edge.
    if (kind === "pipe" && stream.subscribers.length === 2 && stream.subscribers[0].sessionId !== stream.subscribers[1].sessionId) {
      const [a, b] = stream.subscribers;
      ensureSessionNode(a.sessionId).streamCount += 1;
      ensureSessionNode(b.sessionId).streamCount += 1;
      const { source: srcSub, target: tgtSub, bidirectional } = resolvePipeDirection(a, b);
      edges.push({
        id: `edge-pipe-${stream.id}`,
        source: sessionNodeId(srcSub.sessionId),
        target: sessionNodeId(tgtSub.sessionId),
        type: COORD_EDGE_TYPE,
        // Derive metadata from the deterministically-resolved writer so the
        // collapsed edge does not depend on arbitrary subscriber order.
        data: {
          edgeKind: "pipe",
          streamId: stream.id,
          permission: bidirectional ? "rw" : srcSub.permission,
          deliveryMode: srcSub.deliveryMode,
        },
        style: { stroke: "var(--accent-yellow)", strokeWidth: 1.5, strokeDasharray: "6 3" },
        // Bidirectional pipes get arrowheads on both ends; directed pipes only at the reader.
        markerEnd: { type: MarkerType.ArrowClosed },
        markerStart: bidirectional ? { type: MarkerType.ArrowClosed } : undefined,
        animated: false,
      });
      continue;
    }

    // Otherwise render a hub node with one participation edge per subscriber.
    streamNodeData.set(stream.id, { kind: "stream", stream, streamKind: kind, ownership: attributeStreamWithMap(stream, sessionsById) });

    for (const sub of stream.subscribers) {
      ensureSessionNode(sub.sessionId).streamCount += 1;
      const hub = streamNodeId(stream.id);
      const sess = sessionNodeId(sub.sessionId);
      const writes = sub.permission.includes("w");
      const reads = sub.permission.includes("r");

      let source: string;
      let target: string;
      let bidirectional = false;
      if (writes && reads) {
        source = sess;
        target = hub;
        bidirectional = true;
      } else if (reads) {
        source = hub;
        target = sess;
      } else {
        // writer (or unknown) — session feeds the hub
        source = sess;
        target = hub;
      }

      edges.push({
        id: `edge-part-${stream.id}-${sub.subscriptionId}`,
        source,
        target,
        type: COORD_EDGE_TYPE,
        data: { edgeKind: "participation", streamId: stream.id, permission: sub.permission, deliveryMode: sub.deliveryMode },
        style: deliveryStyle(sub.deliveryMode, "var(--text-tertiary)"),
        markerEnd: { type: MarkerType.ArrowClosed },
        markerStart: bidirectional ? { type: MarkerType.ArrowClosed } : undefined,
        animated: false,
      });
    }
  }

  const nodes: Node<CoordNodeData>[] = [];
  for (const [sessionId, data] of sessionNodeData) {
    nodes.push({ id: sessionNodeId(sessionId), type: SESSION_NODE_TYPE, position: { x: 0, y: 0 }, data });
  }
  for (const [streamId, data] of streamNodeData) {
    nodes.push({ id: streamNodeId(streamId), type: STREAM_NODE_TYPE, position: { x: 0, y: 0 }, data });
  }

  return { nodes, edges };
}
