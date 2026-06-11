/**
 * Read-only session query and streaming handlers: listSessions, getSession,
 * getSessionEvents, getTaskSessions, streamSession, streamAll, streamEvents.
 * Extracted from session-handlers.ts (#1470).
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { eventTypeToEnum } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import {
  streamHub,
  logWriter,
  logger,
  createEventStream,
  deliverPendingEscalations,
} from "@grackle-ai/core";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import { requireField, requireSession } from "./require-helpers.js";

/** List sessions with optional filters. */
export async function listSessions(req: grackle.SessionFilter): Promise<grackle.SessionList> {
  const { sessionStore } = getDatabaseStores();
  const rows = sessionStore.listSessions(req.environmentId, req.status);
  return create(grackle.SessionListSchema, {
    sessions: rows.map(sessionRowToProto),
  });
}

/** Get a session by ID. */
export async function getSession(req: grackle.SessionId): Promise<grackle.Session> {
  const row = requireSession(req.id);
  return sessionRowToProto(row);
}

/** Get all events recorded for a session. */
export async function getSessionEvents(req: grackle.SessionId): Promise<grackle.SessionEventList> {
  const session = requireSession(req.id);
  if (!session.logPath) {
    return create(grackle.SessionEventListSchema, {
      sessionId: req.id,
      events: [],
    });
  }
  const entries = logWriter.readLog(session.logPath);
  return create(grackle.SessionEventListSchema, {
    sessionId: req.id,
    events: entries.map((e) =>
      create(grackle.SessionEventSchema, {
        sessionId: e.session_id,
        type: eventTypeToEnum(e.type),
        timestamp: e.timestamp,
        content: e.content,
        raw: e.raw || "",
        toolCallId: e.tool_call_id || "",
        diagnostic: e.diagnostic || false,
        turnId: e.turn_id || "",
        serverSeq: e.server_seq || "",
      }),
    ),
  });
}

/** Get all sessions for a task. */
export async function getTaskSessions(req: grackle.TaskId): Promise<grackle.SessionList> {
  const { sessionStore } = getDatabaseStores();
  requireField(req.id, "task id");
  const rows = sessionStore.listSessionsForTask(req.id);
  return create(grackle.SessionListSchema, {
    sessions: rows.map(sessionRowToProto),
  });
}

/** Stream session events as they occur. */
export async function* streamSession(req: grackle.SessionId): AsyncGenerator<grackle.SessionEvent> {
  const stream = streamHub.createStream(req.id);
  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}

/** Stream all session events across all sessions. */
export async function* streamAll(): AsyncGenerator<grackle.SessionEvent> {
  const stream = streamHub.createGlobalStream();
  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}

/** Stream domain events (replaces WebSocket event broadcasting). */
export async function* streamEvents(): AsyncGenerator<grackle.ServerEvent> {
  // Create the event stream FIRST so the domain-event subscription is registered
  // before draining pending escalations (otherwise drained events would be missed).
  const stream = createEventStream();

  // Drain pending escalations — emits domain events that flow through the stream.
  deliverPendingEscalations().catch((err) => {
    logger.error({ err }, "Failed to drain pending escalations on stream connect");
  });

  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}
