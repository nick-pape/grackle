/**
 * Incrementally project a session's transcript log into TranscriptChunk nodes
 * (#1258).
 *
 * Uses a per-session byte-offset cursor (`logByteOffset`, with `chunkCount`)
 * stored on the Session node so each pass reads + chunks + embeds **only new
 * log content** since the last pass — O(new bytes), never re-reading the whole
 * transcript. New chunks are appended as reference nodes (`transcript_chunk`)
 * with a `PART_OF` edge to the session. The chunk text is re-derivable from the
 * log, so the keystone holds.
 *
 * @module
 */

import { logWriter } from "@grackle-ai/core";
import {
  createTranscriptChunker,
  ingest,
  getReferenceNodeProps,
  upsertReferenceNode,
  upsertEdge,
  deleteReferenceNodesByPrefix,
  REFERENCE_SOURCE,
  EDGE_TYPE,
  type Embedder,
} from "@grackle-ai/knowledge";
import type { SessionRow } from "@grackle-ai/database";

/** Max characters of chunk text kept in the node `label` (a short preview). */
const CHUNK_PREVIEW_LENGTH = 120;

/**
 * Project new transcript content for one session.
 *
 * @returns The number of new chunk nodes created this pass.
 */
export async function projectSessionTranscript(
  session: SessionRow,
  embedder: Embedder,
): Promise<number> {
  if (!session.logPath) {
    return 0;
  }

  // The Session node must already be projected (it carries the cursor + scope).
  const sessionProps = await getReferenceNodeProps(REFERENCE_SOURCE.SESSION, session.id);
  if (!sessionProps) {
    return 0;
  }
  const sessionNodeId = sessionProps.id as string;
  const sessionWorkspaceId = (sessionProps.workspaceId as string | undefined) ?? "";
  const byteOffset =
    typeof sessionProps.logByteOffset === "number" ? sessionProps.logByteOffset : 0;
  let chunkCount = typeof sessionProps.chunkCount === "number" ? sessionProps.chunkCount : 0;

  // Read only the bytes appended since the last pass (O(new bytes), not O(log)).
  const { content: newContent, nextOffset } = logWriter.readLogFrom(session.logPath, byteOffset);

  // Truncation/rewrite: the log shrank below our cursor, so `readLogFrom` reset
  // to offset 0. Clear the stale chunk nodes and reset the chunk index so the
  // re-ingestion from the start neither collides with nor strands old chunks.
  const truncated = nextOffset < byteOffset;
  if (truncated) {
    await deleteReferenceNodesByPrefix(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, `${session.id}#`);
    chunkCount = 0;
  }

  let created = 0;
  if (newContent) {
    const embeddedChunks = await ingest(newContent, createTranscriptChunker(), embedder, {
      sessionId: session.id,
    });

    for (const chunk of embeddedChunks) {
      const index = chunkCount + chunk.index;
      const chunkNodeId = await upsertReferenceNode({
        sourceType: REFERENCE_SOURCE.TRANSCRIPT_CHUNK,
        sourceId: `${session.id}#${index}`,
        label: chunk.text.slice(0, CHUNK_PREVIEW_LENGTH),
        content: chunk.text,
        workspaceId: sessionWorkspaceId,
        embedding: chunk.vector,
      });
      await upsertEdge(chunkNodeId, sessionNodeId, EDGE_TYPE.PART_OF);
    }
    chunkCount += embeddedChunks.length;
    created = embeddedChunks.length;
  }

  // Persist the cursor whenever it moved (or a truncation reset it) — even with
  // no new chunks. `readLogFrom` can advance past an over-long line that yielded
  // no complete line this pass; not persisting that would stall the cursor and
  // re-read the same bytes forever.
  if (truncated || nextOffset !== byteOffset) {
    await upsertReferenceNode({
      sourceType: REFERENCE_SOURCE.SESSION,
      sourceId: session.id,
      label: (sessionProps.label as string | undefined) ?? "",
      workspaceId: sessionWorkspaceId,
      extraProps: { logByteOffset: nextOffset, chunkCount },
    });
  }

  return created;
}

/**
 * Delete all transcript-chunk nodes for a session. Used when a session is
 * pruned (its node's `DETACH DELETE` does not remove the separate chunk nodes).
 *
 * @returns The number of chunk nodes removed.
 */
export async function unprojectSessionTranscript(sessionId: string): Promise<number> {
  return deleteReferenceNodesByPrefix(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, `${sessionId}#`);
}
