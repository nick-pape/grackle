import { describe, it, expect } from "vitest";
import type { KnowledgeNode } from "@grackle-ai/knowledge";
import { knowledgeNodeToProto, knowledgeEdgeToProto } from "./proto-converters.js";

describe("knowledgeNodeToProto", () => {
  it("surfaces content for reference nodes (e.g. transcript chunks)", () => {
    // A transcript-chunk reference node: its body lives in `content` and must
    // round-trip to the proto so search/get responses expose the chunk text.
    const chunk: KnowledgeNode = {
      kind: "reference",
      id: "n1",
      embedding: [],
      createdAt: "t0",
      updatedAt: "t1",
      workspaceId: "ws1",
      sourceType: "transcript_chunk",
      sourceId: "sess1#0",
      label: "Assistant: blue-green rollout…",
      content: "Assistant: The deployment pipeline uses blue-green rollouts.",
    };

    const proto = knowledgeNodeToProto(chunk);
    expect(proto.kind).toBe("reference");
    expect(proto.sourceType).toBe("transcript_chunk");
    expect(proto.label).toBe("Assistant: blue-green rollout…");
    expect(proto.content).toBe("Assistant: The deployment pipeline uses blue-green rollouts.");
  });

  it("defaults reference content to empty string when absent", () => {
    const entity: KnowledgeNode = {
      kind: "reference",
      id: "n2",
      embedding: [],
      createdAt: "t0",
      updatedAt: "t1",
      workspaceId: "ws1",
      sourceType: "task",
      sourceId: "task-1",
      label: "[Task] do the thing",
      // no content
    };
    expect(knowledgeNodeToProto(entity).content).toBe("");
  });

  it("surfaces content (and native-only fields) for native nodes", () => {
    const native: KnowledgeNode = {
      kind: "native",
      id: "n3",
      embedding: [],
      createdAt: "t0",
      updatedAt: "t1",
      workspaceId: "",
      category: "insight",
      title: "A note",
      content: "native body",
      tags: ["a", "b"],
    };
    const proto = knowledgeNodeToProto(native);
    expect(proto.content).toBe("native body");
    expect(proto.title).toBe("A note");
    expect(proto.tags).toEqual(["a", "b"]);
    // reference-only fields blank for native nodes
    expect(proto.sourceType).toBe("");
  });
});

describe("knowledgeEdgeToProto", () => {
  it("serializes metadata to JSON and passes through identity fields", () => {
    const proto = knowledgeEdgeToProto({
      fromId: "a",
      toId: "b",
      type: "PART_OF",
      metadata: { k: "v" },
      createdAt: "t0",
    });
    expect(proto.fromId).toBe("a");
    expect(proto.toId).toBe("b");
    expect(proto.type).toBe("PART_OF");
    expect(proto.metadataJson).toBe(JSON.stringify({ k: "v" }));
  });

  it("emits empty metadataJson when no metadata is present", () => {
    const proto = knowledgeEdgeToProto({
      fromId: "a",
      toId: "b",
      type: "PART_OF",
      createdAt: "t0",
    });
    expect(proto.metadataJson).toBe("");
  });
});
