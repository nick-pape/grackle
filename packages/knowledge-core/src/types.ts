/**
 * Core domain types for the knowledge graph.
 *
 * Defines the two node kinds (reference and native), edge types, and
 * runtime type guards for discriminating between node variants.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Node kind discriminator
// ---------------------------------------------------------------------------

/** Discriminator for knowledge graph node kinds. */
export const NODE_KIND = {
  /** Points to an entity in Grackle's relational DB. No duplicated content. */
  REFERENCE: "reference",
  /** Exists only in the graph. Owns its content. */
  NATIVE: "native",
} as const;

/** Union of all node kind values. */
export type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

// ---------------------------------------------------------------------------
// Reference node source types
// ---------------------------------------------------------------------------

/**
 * Recommended reference source values.
 *
 * Consumers can use these or define their own — the {@link ReferenceSource}
 * type accepts any string.
 */
export const REFERENCE_SOURCE = {
  TASK: "task",
  SESSION: "session",
  FINDING: "finding",
  WORKSPACE: "workspace",
} as const;

/**
 * Entity type that a reference node points to.
 *
 * Open `string` type — not restricted to the values in {@link REFERENCE_SOURCE}.
 * Consumers can define their own source types (e.g., `"ado-work-item"`, `"webpage"`).
 */
export type ReferenceSource = string;

// ---------------------------------------------------------------------------
// Native node categories
// ---------------------------------------------------------------------------

/**
 * Recommended native node categories.
 *
 * Consumers can use these or define their own — the {@link NativeCategory}
 * type accepts any string.
 */
export const NATIVE_CATEGORY = {
  DECISION: "decision",
  INSIGHT: "insight",
  CONCEPT: "concept",
  SNIPPET: "snippet",
} as const;

/**
 * Category for native nodes that exist only in the knowledge graph.
 *
 * Open `string` type — not restricted to the values in {@link NATIVE_CATEGORY}.
 * Consumers can define their own categories (e.g., `"research-note"`, `"requirement"`).
 */
export type NativeCategory = string;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

/** Relationship types between knowledge graph nodes. */
export const EDGE_TYPE = {
  RELATES_TO: "RELATES_TO",
  DEPENDS_ON: "DEPENDS_ON",
  DERIVED_FROM: "DERIVED_FROM",
  MENTIONS: "MENTIONS",
  PART_OF: "PART_OF",
} as const;

/** Union of all edge type values. */
export type EdgeType = (typeof EDGE_TYPE)[keyof typeof EDGE_TYPE];

// ---------------------------------------------------------------------------
// Node interfaces
// ---------------------------------------------------------------------------

/** Properties common to all knowledge graph nodes. */
export interface KnowledgeNodeBase {
  /** Unique node identifier (UUID). */
  id: string;
  /** Which kind of node this is. */
  kind: NodeKind;
  /** Dense vector embedding for similarity search. */
  embedding: number[];
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
  /** Workspace scope (empty string = global). */
  workspaceId: string;
}

/** A reference node — points to an entity in Grackle's relational DB. */
export interface ReferenceNode extends KnowledgeNodeBase {
  kind: typeof NODE_KIND.REFERENCE;
  /** Which entity type this refers to. */
  sourceType: ReferenceSource;
  /** The ID of the entity in Grackle's relational DB. */
  sourceId: string;
  /** Human-readable label derived from the source (e.g., task title). */
  label: string;
}

/** A native node — owns its content directly. */
export interface NativeNode extends KnowledgeNodeBase {
  kind: typeof NODE_KIND.NATIVE;
  /** Subcategory of the native node. */
  category: NativeCategory;
  /** Title or summary. */
  title: string;
  /** Full content owned by this node. */
  content: string;
  /** Free-form tags for categorization. */
  tags: string[];
}

/** Discriminated union of all knowledge graph node types. */
export type KnowledgeNode = ReferenceNode | NativeNode;

// ---------------------------------------------------------------------------
// Edge interface
// ---------------------------------------------------------------------------

/** An edge (relationship) in the knowledge graph. */
export interface KnowledgeEdge {
  /** Source node ID. */
  fromId: string;
  /** Target node ID. */
  toId: string;
  /** Relationship type. */
  type: EdgeType;
  /** Optional metadata (e.g., confidence score, context snippet). */
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp when the edge was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Returns true if the node is a {@link ReferenceNode}. */
export function isReferenceNode(node: KnowledgeNode): node is ReferenceNode {
  return node.kind === NODE_KIND.REFERENCE;
}

/** Returns true if the node is a {@link NativeNode}. */
export function isNativeNode(node: KnowledgeNode): node is NativeNode {
  return node.kind === NODE_KIND.NATIVE;
}
