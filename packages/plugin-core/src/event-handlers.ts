import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import {
  queryDomainEvents as queryDomainEventsStore,
  type DomainEventQuery,
  queryStreamMessages as queryStreamMessagesStore,
  type StreamMessageQuery,
} from "@grackle-ai/database";

/** Map a `domain_events` row to the proto {@link grackle.DomainEvent} message. */
function rowToProto(row: { id: string; type: string; timestamp: string; payload: string }): grackle.DomainEvent {
  return create(grackle.DomainEventSchema, {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    payloadJson: row.payload,
  });
}

/**
 * Query the persisted `domain_events` log (RFC #1264 Phase 1 — the gRPC read side
 * of the event store). Maps request filters to {@link queryDomainEventsStore} and
 * rows back to proto, oldest first.
 *
 * @param req - Offset / type / time filters and limit.
 * @returns The matching domain events.
 */
export async function queryDomainEvents(
  req: grackle.QueryDomainEventsRequest,
): Promise<grackle.DomainEventList> {
  const query: DomainEventQuery = {};
  if (req.beforeId) {
    query.beforeId = req.beforeId;
  }
  if (req.type) {
    query.type = req.type;
  }
  if (req.since) {
    query.since = req.since;
  }
  if (req.until) {
    query.until = req.until;
  }
  if (req.limit > 0) {
    query.limit = req.limit;
  }

  const rows = queryDomainEventsStore(query);
  return create(grackle.DomainEventListSchema, { events: rows.map(rowToProto) });
}

/** Map a `stream_messages` row to the proto {@link grackle.StreamMessageEvent} message. */
function streamRowToProto(
  row: { seq: string; streamId: string; senderId: string; content: string; timestamp: string },
): grackle.StreamMessageEvent {
  return create(grackle.StreamMessageEventSchema, {
    streamId: row.streamId,
    seq: row.seq,
    senderId: row.senderId,
    content: row.content,
    timestamp: row.timestamp,
  });
}

/**
 * Read a stream room's durable transcript (RFC #1264 Phase 2 — the gRPC read side
 * of the `stream_messages` log). Most recent first; `before_seq` pages older.
 *
 * @param req - Stream id, optional `before_seq` cursor, and limit.
 * @returns The matching stream messages.
 */
export async function getStreamTranscript(
  req: grackle.GetStreamTranscriptRequest,
): Promise<grackle.StreamTranscript> {
  const query: StreamMessageQuery = { streamId: req.streamId };
  if (req.beforeSeq) {
    query.beforeSeq = req.beforeSeq;
  }
  if (req.limit > 0) {
    query.limit = req.limit;
  }

  const rows = queryStreamMessagesStore(query);
  return create(grackle.StreamTranscriptSchema, { messages: rows.map(streamRowToProto) });
}
