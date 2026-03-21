import { describe, it, expect } from "vitest";
import {
  NODE_KIND,
  REFERENCE_SOURCE,
  NATIVE_CATEGORY,
  EDGE_TYPE,
  isReferenceNode,
  isNativeNode,
  type ReferenceNode,
  type NativeNode,
} from "./types.js";

describe("NODE_KIND", () => {
  it("has reference and native values", () => {
    expect(NODE_KIND.REFERENCE).toBe("reference");
    expect(NODE_KIND.NATIVE).toBe("native");
  });
});

describe("REFERENCE_SOURCE", () => {
  it("has all expected source types", () => {
    expect(REFERENCE_SOURCE.TASK).toBe("task");
    expect(REFERENCE_SOURCE.SESSION).toBe("session");
    expect(REFERENCE_SOURCE.FINDING).toBe("finding");
    expect(REFERENCE_SOURCE.WORKSPACE).toBe("workspace");
  });
});

describe("NATIVE_CATEGORY", () => {
  it("has all expected categories", () => {
    expect(NATIVE_CATEGORY.DECISION).toBe("decision");
    expect(NATIVE_CATEGORY.INSIGHT).toBe("insight");
    expect(NATIVE_CATEGORY.CONCEPT).toBe("concept");
    expect(NATIVE_CATEGORY.SNIPPET).toBe("snippet");
  });
});

describe("EDGE_TYPE", () => {
  it("has all expected edge types", () => {
    expect(EDGE_TYPE.RELATES_TO).toBe("RELATES_TO");
    expect(EDGE_TYPE.DEPENDS_ON).toBe("DEPENDS_ON");
    expect(EDGE_TYPE.DERIVED_FROM).toBe("DERIVED_FROM");
    expect(EDGE_TYPE.MENTIONS).toBe("MENTIONS");
    expect(EDGE_TYPE.PART_OF).toBe("PART_OF");
  });
});

function makeReferenceNode(): ReferenceNode {
  return {
    id: "ref-1",
    kind: NODE_KIND.REFERENCE,
    sourceType: REFERENCE_SOURCE.TASK,
    sourceId: "task-123",
    label: "Fix login bug",
    embedding: [0.1, 0.2],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    workspaceId: "ws-1",
  };
}

function makeNativeNode(): NativeNode {
  return {
    id: "native-1",
    kind: NODE_KIND.NATIVE,
    category: NATIVE_CATEGORY.DECISION,
    title: "Use Neo4j",
    content: "We decided to use Neo4j for the knowledge graph.",
    tags: ["architecture"],
    embedding: [0.3, 0.4],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    workspaceId: "",
  };
}

describe("isReferenceNode", () => {
  it("returns true for a reference node", () => {
    expect(isReferenceNode(makeReferenceNode())).toBe(true);
  });

  it("returns false for a native node", () => {
    expect(isReferenceNode(makeNativeNode())).toBe(false);
  });
});

describe("isNativeNode", () => {
  it("returns true for a native node", () => {
    expect(isNativeNode(makeNativeNode())).toBe(true);
  });

  it("returns false for a reference node", () => {
    expect(isNativeNode(makeReferenceNode())).toBe(false);
  });
});
