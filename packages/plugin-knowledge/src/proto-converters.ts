/**
 * Proto converters for knowledge graph types.
 *
 * @module
 */

import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import type { KnowledgeNode, KnowledgeEdge } from "@grackle-ai/knowledge";

/** Convert a KnowledgeNode to its proto representation. */
export function knowledgeNodeToProto(node: KnowledgeNode): grackle.KnowledgeNodeProto {
  return create(grackle.KnowledgeNodeProtoSchema, {
    id: node.id,
    kind: node.kind,
    workspaceId: node.workspaceId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    sourceType: node.kind === "reference" ? node.sourceType : "",
    sourceId: node.kind === "reference" ? node.sourceId : "",
    label: node.kind === "reference" ? node.label : "",
    category: node.kind === "native" ? node.category : "",
    title: node.kind === "native" ? node.title : "",
    content: node.kind === "native" ? node.content : "",
    tags: node.kind === "native" ? node.tags : [],
  });
}

/** Convert a KnowledgeEdge to its proto representation. */
export function knowledgeEdgeToProto(edge: KnowledgeEdge): grackle.KnowledgeEdgeProto {
  return create(grackle.KnowledgeEdgeProtoSchema, {
    fromId: edge.fromId,
    toId: edge.toId,
    type: edge.type,
    metadataJson: edge.metadata ? JSON.stringify(edge.metadata) : "",
    createdAt: edge.createdAt,
  });
}
