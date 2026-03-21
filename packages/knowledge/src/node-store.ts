/**
 * Node CRUD operations for the knowledge graph.
 *
 * Provides create, read, update, and delete operations for both
 * {@link ReferenceNode} and {@link NativeNode} types, backed by Neo4j.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { getSession } from "./client.js";
import { logger } from "./logger.js";
import { NODE_LABEL } from "./constants.js";
import {
  NODE_KIND,
  type NodeKind,
  type ReferenceSource,
  type NativeCategory,
  type KnowledgeNode,
  type KnowledgeEdge,
  type EdgeType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a reference node. Excludes auto-generated fields. */
export interface CreateReferenceNodeInput {
  /** Which entity type this refers to. */
  sourceType: ReferenceSource;
  /** The ID of the entity in Grackle's relational DB. */
  sourceId: string;
  /** Human-readable label derived from the source. */
  label: string;
  /** Dense vector embedding for similarity search. */
  embedding: number[];
  /** Workspace scope (empty string = global). */
  workspaceId: string;
}

/** Input for creating a native node. Excludes auto-generated fields. */
export interface CreateNativeNodeInput {
  /** Subcategory of the native node. */
  category: NativeCategory;
  /** Title or summary. */
  title: string;
  /** Full content owned by this node. */
  content: string;
  /** Free-form tags for categorization. */
  tags: string[];
  /** Dense vector embedding for similarity search. */
  embedding: number[];
  /** Workspace scope (empty string = global). */
  workspaceId: string;
}

/** Fields that can be updated on a reference node. */
export interface UpdateReferenceNodeInput {
  /** Updated label. */
  label?: string;
  /** Updated source ID. */
  sourceId?: string;
  /** Updated embedding vector. */
  embedding?: number[];
}

/** Fields that can be updated on a native node. */
export interface UpdateNativeNodeInput {
  /** Updated title. */
  title?: string;
  /** Updated content. */
  content?: string;
  /** Updated tags. */
  tags?: string[];
  /** Updated embedding vector. */
  embedding?: number[];
}

/** Union of update inputs for either node kind. */
export type UpdateNodeInput = UpdateReferenceNodeInput | UpdateNativeNodeInput;

/** A node together with all its edges. */
export interface NodeWithEdges {
  /** The knowledge graph node. */
  node: KnowledgeNode;
  /** All edges connected to this node (both incoming and outgoing). */
  edges: KnowledgeEdge[];
}

// ---------------------------------------------------------------------------
// Cypher queries
// ---------------------------------------------------------------------------

const GET_NODE_WITH_EDGES_CYPHER: string = `
  MATCH (n:${NODE_LABEL} {id: $id})
  OPTIONAL MATCH (n)-[r]-(m:${NODE_LABEL})
  WITH n, r, m
  WHERE r IS NOT NULL
  RETURN n,
    collect({
      fromId: CASE WHEN startNode(r) = n THEN n.id ELSE m.id END,
      toId: CASE WHEN endNode(r) = n THEN n.id ELSE m.id END,
      type: type(r),
      metadata: r.metadata,
      createdAt: r.createdAt
    }) AS edges
  UNION ALL
  MATCH (n:${NODE_LABEL} {id: $id})
  WHERE NOT (n)-[]-()
  RETURN n, [] AS edges`;

const DELETE_NODE_CYPHER: string = `
  MATCH (n:${NODE_LABEL} {id: $id})
  DETACH DELETE n
  RETURN count(n) AS deleted`;

const UPDATE_NODE_CYPHER: string = `
  MATCH (n:${NODE_LABEL} {id: $id})
  SET n += $updates
  RETURN n`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Neo4j node properties to a typed {@link KnowledgeNode}.
 *
 * Handles the discriminated union based on the `kind` property.
 */
export function recordToNode(
  properties: Record<string, unknown>,
): KnowledgeNode {
  const base = {
    id: properties.id as string,
    kind: properties.kind as NodeKind,
    embedding: (properties.embedding as number[] | undefined) ?? [],
    createdAt: properties.createdAt as string,
    updatedAt: properties.updatedAt as string,
    workspaceId: (properties.workspaceId as string | undefined) ?? "",
  };

  if (base.kind === NODE_KIND.REFERENCE) {
    return {
      ...base,
      kind: NODE_KIND.REFERENCE,
      sourceType: properties.sourceType as ReferenceSource,
      sourceId: properties.sourceId as string,
      label: (properties.label as string | undefined) ?? "",
    };
  }

  return {
    ...base,
    kind: NODE_KIND.NATIVE,
    category: properties.category as NativeCategory,
    title: (properties.title as string | undefined) ?? "",
    content: (properties.content as string | undefined) ?? "",
    tags: (properties.tags as string[] | undefined) ?? [],
  };
}

/**
 * Convert a raw edge object from Cypher `collect()` to a {@link KnowledgeEdge}.
 */
function recordToEdge(raw: Record<string, unknown>): KnowledgeEdge {
  let metadata: Record<string, unknown> | undefined;
  if (raw.metadata !== undefined && raw.metadata !== null) {
    try {
      metadata = JSON.parse(raw.metadata as string) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }

  return {
    fromId: raw.fromId as string,
    toId: raw.toId as string,
    type: raw.type as EdgeType,
    metadata,
    createdAt: raw.createdAt as string,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a reference node in the knowledge graph.
 *
 * Generates a UUID and timestamps automatically.
 *
 * @returns The ID of the created node.
 */
export async function createReferenceNode(
  input: CreateReferenceNodeInput,
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const props = {
    id,
    kind: NODE_KIND.REFERENCE,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    label: input.label,
    embedding: input.embedding,
    workspaceId: input.workspaceId,
    createdAt: now,
    updatedAt: now,
  };

  const session = getSession();
  try {
    await session.run(`CREATE (n:${NODE_LABEL} $props) RETURN n`, { props });
    logger.debug({ nodeId: id, kind: NODE_KIND.REFERENCE }, "Created reference node");
    return id;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after createReferenceNode");
    }
  }
}

/**
 * Create a native node in the knowledge graph.
 *
 * Generates a UUID and timestamps automatically.
 *
 * @returns The ID of the created node.
 */
export async function createNativeNode(
  input: CreateNativeNodeInput,
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const props = {
    id,
    kind: NODE_KIND.NATIVE,
    category: input.category,
    title: input.title,
    content: input.content,
    tags: input.tags,
    embedding: input.embedding,
    workspaceId: input.workspaceId,
    createdAt: now,
    updatedAt: now,
  };

  const session = getSession();
  try {
    await session.run(`CREATE (n:${NODE_LABEL} $props) RETURN n`, { props });
    logger.debug({ nodeId: id, kind: NODE_KIND.NATIVE }, "Created native node");
    return id;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after createNativeNode");
    }
  }
}

/**
 * Get a node by ID, including all its edges.
 *
 * @returns The node and its edges, or `undefined` if the node was not found.
 */
export async function getNode(id: string): Promise<NodeWithEdges | undefined> {
  const session = getSession();
  try {
    const result = await session.run(GET_NODE_WITH_EDGES_CYPHER, { id });

    if (result.records.length === 0) {
      return undefined;
    }

    const record = result.records[0];
    const neo4jNode = record.get("n") as { properties: Record<string, unknown> };
    const rawEdges = record.get("edges") as Record<string, unknown>[];

    const node = recordToNode(neo4jNode.properties);
    const edges = rawEdges.map(recordToEdge);

    return { node, edges };
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after getNode");
    }
  }
}

/**
 * Delete a node and all its edges (`DETACH DELETE`).
 *
 * @returns `true` if a node was deleted, `false` if the node was not found.
 */
export async function deleteNode(id: string): Promise<boolean> {
  const session = getSession();
  try {
    const result = await session.run(DELETE_NODE_CYPHER, { id });
    const deleted = result.records[0]?.get("deleted") as number;
    if (deleted > 0) {
      logger.debug({ nodeId: id }, "Deleted node");
    }
    return deleted > 0;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after deleteNode");
    }
  }
}

/**
 * Update a node's mutable properties.
 *
 * Cannot change `kind`, `id`, `createdAt`, or `workspaceId`.
 * Automatically updates the `updatedAt` timestamp.
 *
 * @returns The updated node, or `undefined` if the node was not found.
 */
export async function updateNode(
  id: string,
  updates: UpdateNodeInput,
): Promise<KnowledgeNode | undefined> {
  // Strip immutable fields defensively.
  const { ...mutableUpdates } = updates;
  const forbidden = ["kind", "id", "createdAt", "workspaceId"] as const;
  for (const key of forbidden) {
    delete (mutableUpdates as Record<string, unknown>)[key];
  }

  const patchedUpdates = {
    ...mutableUpdates,
    updatedAt: new Date().toISOString(),
  };

  const session = getSession();
  try {
    const result = await session.run(UPDATE_NODE_CYPHER, {
      id,
      updates: patchedUpdates,
    });

    if (result.records.length === 0) {
      return undefined;
    }

    const neo4jNode = result.records[0].get("n") as {
      properties: Record<string, unknown>;
    };
    return recordToNode(neo4jNode.properties);
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after updateNode");
    }
  }
}
