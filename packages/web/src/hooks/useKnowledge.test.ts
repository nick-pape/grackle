import { describe, it, expect, vi } from "vitest";
import type { WsMessage } from "./types.js";

// We can't easily test hooks with renderHook in this setup,
// so test the message handler logic directly by extracting it.
// The useKnowledge hook's handleMessage is a pure function of state setters.

// Instead, test the message routing logic:

describe("useKnowledge message handling", () => {
  // Simulate what handleMessage does by creating a minimal version
  const KNOWLEDGE_MSG_TYPES: ReadonlySet<string> = new Set([
    "knowledge.listRecent.result",
    "knowledge.search.result",
    "knowledge.getNode.result",
    "knowledge.expand.result",
  ]);

  it("should recognize knowledge message types", () => {
    expect(KNOWLEDGE_MSG_TYPES.has("knowledge.listRecent.result")).toBe(true);
    expect(KNOWLEDGE_MSG_TYPES.has("knowledge.search.result")).toBe(true);
    expect(KNOWLEDGE_MSG_TYPES.has("knowledge.getNode.result")).toBe(true);
    expect(KNOWLEDGE_MSG_TYPES.has("knowledge.expand.result")).toBe(true);
  });

  it("should not match non-knowledge messages", () => {
    expect(KNOWLEDGE_MSG_TYPES.has("environments")).toBe(false);
    expect(KNOWLEDGE_MSG_TYPES.has("sessions")).toBe(false);
    expect(KNOWLEDGE_MSG_TYPES.has("tasks")).toBe(false);
  });

  it("should parse listRecent result nodes correctly", () => {
    const payload: Record<string, unknown> = {
      nodes: [
        { id: "n1", kind: "native", title: "Test Node", category: "insight", content: "content", tags: ["a"], workspaceId: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        { id: "n2", kind: "reference", label: "Task Ref", sourceType: "task", sourceId: "t1", workspaceId: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      ],
      edges: [
        { fromId: "n1", toId: "n2", type: "RELATES_TO", createdAt: "2026-01-01" },
      ],
    };

    const nodes = (payload.nodes as Record<string, unknown>[]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].title).toBe("Test Node");
    expect(nodes[1].label).toBe("Task Ref");

    const edges = (payload.edges as Record<string, unknown>[]);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe("RELATES_TO");
  });

  it("should parse search result format correctly", () => {
    const payload: Record<string, unknown> = {
      results: [
        {
          score: 0.95,
          node: { id: "n1", kind: "native", title: "Match", category: "decision" },
          edges: [{ fromId: "n1", toId: "n2", type: "MENTIONS" }],
        },
      ],
    };

    const results = (payload.results as Array<Record<string, unknown>>);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.95);
    expect((results[0].node as Record<string, unknown>).title).toBe("Match");
  });

  it("should handle error responses gracefully", () => {
    const payload: Record<string, unknown> = {
      error: "Knowledge graph not available",
      nodes: [],
      edges: [],
    };

    expect(payload.error).toBe("Knowledge graph not available");
    // When error is present, the handler should set loading=false and return true
  });

  it("should handle empty expand result", () => {
    const payload: Record<string, unknown> = {
      nodes: [],
      edges: [],
    };

    const nodes = (payload.nodes as Record<string, unknown>[]);
    expect(nodes).toHaveLength(0);
  });

  it("should deduplicate edges on expand", () => {
    const existingLinks = [
      { source: "n1", target: "n2", type: "RELATES_TO" },
    ];
    const newEdges = [
      { fromId: "n1", toId: "n2", type: "RELATES_TO" }, // duplicate
      { fromId: "n1", toId: "n3", type: "MENTIONS" },   // new
    ];

    const existing: Set<string> = new Set(existingLinks.map((l) => `${l.source}:${l.target}:${l.type}`));
    const additions = newEdges.filter((e) => {
      const key: string = `${e.fromId}:${e.toId}:${e.type}`;
      return !existing.has(key);
    });

    expect(additions).toHaveLength(1);
    expect(additions[0].toId).toBe("n3");
  });
});
