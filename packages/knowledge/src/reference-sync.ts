/**
 * Reference node synchronization with Grackle entities.
 *
 * Provides lookup, upsert, and deletion of reference nodes keyed by
 * `(sourceType, sourceId)`, plus pure text-derivation helpers for
 * producing embeddable strings from entity data.
 *
 * The server-side event bus wiring that calls these functions is in #713.
 *
 * @module
 */

import {
  getSession,
  logger,
  NODE_LABEL,
  type ReferenceSource,
  type ReferenceNode,
  isReferenceNode,
  type Embedder,
  createReferenceNode,
  updateNode,
  recordToNode,
} from "@grackle-ai/knowledge-core";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for syncing a reference node with a Grackle entity. */
export interface SyncReferenceNodeInput {
  /** Which entity type this refers to. */
  sourceType: ReferenceSource;
  /** The ID of the entity in Grackle's relational DB. */
  sourceId: string;
  /** Human-readable label derived from the source (e.g., task title). */
  label: string;
  /** Text content to derive the embedding from. */
  text: string;
  /** Workspace scope (empty string = global). */
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Cypher queries
// ---------------------------------------------------------------------------

const FIND_BY_SOURCE_CYPHER: string = `
  MATCH (n:${NODE_LABEL} {kind: 'reference', sourceType: $sourceType, sourceId: $sourceId})
  RETURN n`;

const DELETE_BY_SOURCE_CYPHER: string = `
  MATCH (n:${NODE_LABEL} {kind: 'reference', sourceType: $sourceType, sourceId: $sourceId})
  DETACH DELETE n
  RETURN count(n) AS deleted`;

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Find a reference node by its source identity.
 *
 * Uses the composite index on `(sourceType, sourceId)` for efficient lookup.
 *
 * @param sourceType - The entity type (task, finding, session, workspace).
 * @param sourceId - The entity ID from Grackle's relational DB.
 * @returns The reference node if found, or `undefined`.
 */
export async function findReferenceNodeBySource(
  sourceType: ReferenceSource,
  sourceId: string,
): Promise<ReferenceNode | undefined> {
  const session = getSession();
  try {
    const result = await session.run(FIND_BY_SOURCE_CYPHER, {
      sourceType,
      sourceId,
    });

    if (result.records.length === 0) {
      return undefined;
    }

    const neo4jNode = result.records[0].get("n") as {
      properties: Record<string, unknown>;
    };
    const node = recordToNode(neo4jNode.properties);

    if (!isReferenceNode(node)) {
      logger.warn(
        { sourceType, sourceId, kind: node.kind },
        "findReferenceNodeBySource matched a non-reference node",
      );
      return undefined;
    }

    return node;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn(
        { err: closeError },
        "Failed to close session after findReferenceNodeBySource",
      );
    }
  }
}

/**
 * Delete a reference node by its source identity.
 *
 * Removes the node and all its edges (`DETACH DELETE`). Used when the
 * corresponding entity is deleted in Grackle's relational DB.
 *
 * @param sourceType - The entity type (task, finding, session, workspace).
 * @param sourceId - The entity ID from Grackle's relational DB.
 * @returns `true` if a node was deleted, `false` if no matching node existed.
 */
export async function deleteReferenceNodeBySource(
  sourceType: ReferenceSource,
  sourceId: string,
): Promise<boolean> {
  const session = getSession();
  try {
    const result = await session.run(DELETE_BY_SOURCE_CYPHER, {
      sourceType,
      sourceId,
    });

    const deleted = result.records[0]?.get("deleted") as number;
    if (deleted > 0) {
      logger.debug({ sourceType, sourceId }, "Deleted reference node by source");
    }
    return deleted > 0;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn(
        { err: closeError },
        "Failed to close session after deleteReferenceNodeBySource",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Sync (upsert)
// ---------------------------------------------------------------------------

/**
 * Upsert a reference node for a Grackle entity.
 *
 * Derives an embedding from the provided text, then either creates a new
 * reference node or updates the existing one (matched by sourceType + sourceId).
 *
 * @param embedder - The embedder to produce the embedding vector.
 * @param input - The entity data to sync.
 * @returns The node ID (either existing or newly created).
 */
export async function syncReferenceNode(
  embedder: Embedder,
  input: SyncReferenceNodeInput,
): Promise<string> {
  const { vector } = await embedder.embed(input.text);

  const existing = await findReferenceNodeBySource(
    input.sourceType,
    input.sourceId,
  );

  if (existing) {
    await updateNode(existing.id, { label: input.label, embedding: vector });
    logger.debug(
      { nodeId: existing.id, sourceType: input.sourceType, sourceId: input.sourceId },
      "Updated reference node",
    );
    return existing.id;
  }

  const newId = await createReferenceNode({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    label: input.label,
    embedding: vector,
    workspaceId: input.workspaceId,
  });
  logger.debug(
    { nodeId: newId, sourceType: input.sourceType, sourceId: input.sourceId },
    "Created reference node",
  );
  return newId;
}

// ---------------------------------------------------------------------------
// Text derivation helpers (pure functions)
// ---------------------------------------------------------------------------

/**
 * Derive embeddable text from a task's title and description.
 *
 * @param title - The task title.
 * @param description - The task description (may be empty).
 * @returns A formatted text string suitable for embedding.
 */
export function deriveTaskText(title: string, description: string): string {
  const parts: string[] = [`[Task] ${title}`];
  if (description) {
    parts.push(description);
  }
  return parts.join(" - ");
}

/**
 * Derive embeddable text from a finding's title, content, and tags.
 *
 * @param title - The finding title.
 * @param content - The finding content.
 * @param tags - Free-form tags for categorization.
 * @returns A formatted text string suitable for embedding.
 */
export function deriveFindingText(
  title: string,
  content: string,
  tags: string[],
): string {
  const parts: string[] = [`[Finding] ${title}`];
  if (content) {
    parts.push(content);
  }
  if (tags.length > 0) {
    parts.push(`tags:${tags.join(",")}`);
  }
  return parts.join(" - ");
}
