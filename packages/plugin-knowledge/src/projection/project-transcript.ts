/**
 * Incrementally project a session's transcript log into TranscriptChunk nodes
 * (#1258).
 *
 * Uses a per-session content cursor (`chunkedLogLines`) stored on the Session
 * node so each pass chunks + embeds **only new log content** since the last
 * pass — O(new bytes), never re-chunking the whole transcript. New chunks are
 * appended as reference nodes (`transcript_chunk`) with a `PART_OF` edge to the
 * session. The chunk text is re-derivable from the log, so the keystone holds.
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
  listReferenceSourceIds,
  deleteReferenceNodeBySource,
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
  const chunkedLines =
    typeof sessionProps.chunkedLogLines === "number" ? sessionProps.chunkedLogLines : 0;
  let chunkCount = typeof sessionProps.chunkCount === "number" ? sessionProps.chunkCount : 0;

  const entries = logWriter.readLog(session.logPath);
  if (entries.length <= chunkedLines) {
    return 0; // no new log content since the last pass
  }

  // Chunk + embed only the new lines (reconstruct JSONL for the chunker).
  const newContent = entries
    .slice(chunkedLines)
    .map((entry) => JSON.stringify(entry))
    .join("\n");
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

  // Advance the per-session cursor (idempotent MERGE; preserves other props).
  await upsertReferenceNode({
    sourceType: REFERENCE_SOURCE.SESSION,
    sourceId: session.id,
    label: (sessionProps.label as string | undefined) ?? "",
    workspaceId: sessionWorkspaceId,
    extraProps: { chunkedLogLines: entries.length, chunkCount },
  });

  return embeddedChunks.length;
}

/**
 * Delete all transcript-chunk nodes for a session. Used when a session is
 * pruned (its node's `DETACH DELETE` does not remove the separate chunk nodes).
 *
 * @returns The number of chunk nodes removed.
 */
export async function unprojectSessionTranscript(sessionId: string): Promise<number> {
  const prefix = `${sessionId}#`;
  let removed = 0;
  for (const sourceId of await listReferenceSourceIds(REFERENCE_SOURCE.TRANSCRIPT_CHUNK)) {
    if (sourceId.startsWith(prefix)) {
      await deleteReferenceNodeBySource(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, sourceId);
      removed += 1;
    }
  }
  return removed;
}
