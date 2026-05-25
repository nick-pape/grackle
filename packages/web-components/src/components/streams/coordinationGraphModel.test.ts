import { describe, it, expect } from "vitest";
import type { Session, StreamData, StreamSubscriberData } from "../../hooks/types.js";
import {
  buildCoordinationGraph,
  SESSION_NODE_TYPE,
  STREAM_NODE_TYPE,
  type CoordEdgeData,
  type CoordNodeData,
  type SessionNodeData,
} from "./coordinationGraphModel.js";
import type { Edge, Node } from "@xyflow/react";

function makeSub(sessionId: string, permission: string = "rw", deliveryMode: string = "async"): StreamSubscriberData {
  return { subscriptionId: `sub-${sessionId}`, sessionId, fd: 3, permission, deliveryMode, createdBySpawn: false };
}

function makeStream(over: Partial<StreamData> & { id: string; name: string }): StreamData {
  return {
    subscriberCount: over.subscribers?.length ?? 0,
    messageBufferDepth: 0,
    selfEcho: false,
    subscribers: [],
    ...over,
  };
}

function makeSession(id: string, taskId?: string): Session {
  return { id, environmentId: "env-1", runtime: "claude-code", status: "running", prompt: "", startedAt: "2026-01-01T00:00:00Z", taskId };
}

function sessionNodes(nodes: Node<CoordNodeData>[]): Node<CoordNodeData>[] {
  return nodes.filter((n) => n.type === SESSION_NODE_TYPE);
}

function streamNodes(nodes: Node<CoordNodeData>[]): Node<CoordNodeData>[] {
  return nodes.filter((n) => n.type === STREAM_NODE_TYPE);
}

function edgeById(edges: Edge<CoordEdgeData>[], id: string): Edge<CoordEdgeData> {
  const edge = edges.find((e) => e.id === id);
  if (!edge) {
    throw new Error(`edge not found: ${id}`);
  }
  return edge;
}

describe("buildCoordinationGraph", () => {
  it("returns empty for no streams", () => {
    expect(buildCoordinationGraph([], [makeSession("s1")])).toEqual({ nodes: [], edges: [] });
  });

  it("renders a chatroom as a hub with one participation edge per subscriber", () => {
    const stream = makeStream({
      id: "room1",
      name: "planning",
      selfEcho: true,
      subscribers: [makeSub("s1", "rw"), makeSub("s2", "r")],
    });
    const { nodes, edges } = buildCoordinationGraph([stream], [makeSession("s1", "task-1"), makeSession("s2", "task-1")]);

    expect(streamNodes(nodes)).toHaveLength(1);
    expect(sessionNodes(nodes)).toHaveLength(2);
    expect(edges).toHaveLength(2);
  });

  it("emits a single bidirectional edge for an rw subscriber (never two)", () => {
    const stream = makeStream({ id: "room1", name: "planning", selfEcho: true, subscribers: [makeSub("s1", "rw")] });
    const { edges } = buildCoordinationGraph([stream], [makeSession("s1")]);

    expect(edges).toHaveLength(1);
    const edge = edgeById(edges, "edge-part-room1-sub-s1");
    expect(edge.source).toBe("session:s1");
    expect(edge.target).toBe("stream:room1");
    expect(edge.markerStart).toBeDefined();
    expect(edge.markerEnd).toBeDefined();
  });

  it("orients a writer subscriber session -> hub and a reader hub -> session", () => {
    const stream = makeStream({
      id: "ch1",
      name: "telemetry",
      subscribers: [makeSub("w1", "w"), makeSub("r1", "r")],
    });
    const { edges } = buildCoordinationGraph([stream], [makeSession("w1"), makeSession("r1")]);

    const writer = edgeById(edges, "edge-part-ch1-sub-w1");
    expect(writer.source).toBe("session:w1");
    expect(writer.target).toBe("stream:ch1");
    expect(writer.markerStart).toBeUndefined();

    const reader = edgeById(edges, "edge-part-ch1-sub-r1");
    expect(reader.source).toBe("stream:ch1");
    expect(reader.target).toBe("session:r1");
  });

  it("collapses a 2-party pipe into a direct writer -> reader edge with no hub node", () => {
    const stream = makeStream({ id: "p1", name: "pipe:s1-s2", subscribers: [makeSub("s1", "w"), makeSub("s2", "r")] });
    const { nodes, edges } = buildCoordinationGraph([stream], [makeSession("s1"), makeSession("s2")]);

    expect(streamNodes(nodes)).toHaveLength(0);
    expect(sessionNodes(nodes)).toHaveLength(2);
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge.data?.edgeKind).toBe("pipe");
    expect(edge.source).toBe("session:s1");
    expect(edge.target).toBe("session:s2");
    expect(edge.markerEnd).toBeDefined();
    expect(edge.markerStart).toBeUndefined();
  });

  it("draws a collapsed rw/rw pipe as bidirectional in deterministic order", () => {
    const stream = makeStream({ id: "p2", name: "pipe:b-a", subscribers: [makeSub("b", "rw"), makeSub("a", "rw")] });
    const { edges } = buildCoordinationGraph([stream], [makeSession("a"), makeSession("b")]);

    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge.source).toBe("session:a");
    expect(edge.target).toBe("session:b");
    expect(edge.markerStart).toBeDefined();
    expect(edge.markerEnd).toBeUndefined();
  });

  it("does not collapse a pipe with more than two subscribers (falls back to a hub)", () => {
    const stream = makeStream({
      id: "p3",
      name: "pipe:multi",
      subscribers: [makeSub("s1"), makeSub("s2"), makeSub("s3")],
    });
    const { nodes } = buildCoordinationGraph([stream], [makeSession("s1"), makeSession("s2"), makeSession("s3")]);
    expect(streamNodes(nodes)).toHaveLength(1);
  });

  it("synthesizes an external session node for an unknown subscriber id", () => {
    const stream = makeStream({ id: "cli", name: "cli-inspector", subscribers: [makeSub("ext-1", "rw")] });
    const { nodes } = buildCoordinationGraph([stream], []);

    const sessNodes = sessionNodes(nodes);
    expect(sessNodes).toHaveLength(1);
    expect((sessNodes[0].data as SessionNodeData).external).toBe(true);
  });

  it("counts the streams each session participates in", () => {
    const a = makeStream({ id: "room", name: "room", selfEcho: true, subscribers: [makeSub("s1", "rw"), makeSub("s2", "r")] });
    const b = makeStream({ id: "chan", name: "metrics", subscribers: [makeSub("s1", "r")] });
    const { nodes } = buildCoordinationGraph([a, b], [makeSession("s1"), makeSession("s2")]);

    const s1 = sessionNodes(nodes).find((n) => n.id === "session:s1");
    expect((s1?.data as SessionNodeData).streamCount).toBe(2);
  });
});
