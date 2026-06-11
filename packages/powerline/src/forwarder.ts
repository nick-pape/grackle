/**
 * Per-(client, session) event forwarder: drains parked events, tails the live
 * pump buffer, and maps each {@link AgentEvent} through the AHP forward mapper
 * as `action` notifications.
 * @module forwarder
 */

import type { StateAction } from "@grackle-ai/ahp";
import { ActionType } from "@grackle-ai/ahp";
import type { AhpServerConnection } from "@grackle-ai/ahp-transport";
import { mapAgentEvent } from "@grackle-ai/common";
import type { AgentEvent } from "@grackle-ai/runtime-sdk";

import type { ClientState, ForwarderState } from "./ahp-types.js";
import { sessionChannel } from "./channel-codec.js";
import {
  drainParkedSession,
  getSessionPump,
  registerPumpForwarder,
  unregisterPumpForwarder,
} from "./session-mgr.js";

/**
 * Drive the parked-event replay + live-buffer tail loop for a single
 * (client, session) subscription.
 */
export async function runForwarder(
  conn: AhpServerConnection,
  sessionId: string,
  forwarder: ForwarderState,
  clients: Map<string, ClientState>,
): Promise<void> {
  if (forwarder.cancelled) {
    const cState = clients.get(conn.clientId);
    if (cState?.forwarders.get(sessionId) === forwarder) {
      cState.forwarders.delete(sessionId);
    }
    return;
  }
  const parked = drainParkedSession(sessionId);
  if (parked !== undefined) {
    for (const event of parked) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (forwarder.cancelled) {
        return;
      }
      emitActionsForEvent(conn, sessionId, event, forwarder);
    }
  }
  const pump = getSessionPump(sessionId);
  if (pump === undefined) {
    const cState = clients.get(conn.clientId);
    if (cState?.forwarders.get(sessionId) === forwarder) {
      cState.forwarders.delete(sessionId);
    }
    return;
  }
  forwarder.pos =
    pump.totalForwardersAttached === 0
      ? pump.bufferStartIndex
      : pump.bufferStartIndex + pump.buffer.length;
  registerPumpForwarder(pump, forwarder);
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (!forwarder.cancelled) {
      const bufLen = pump.bufferStartIndex + pump.buffer.length;
      while (forwarder.pos < bufLen) {
        const localIdx = forwarder.pos - pump.bufferStartIndex;
        emitActionsForEvent(conn, sessionId, pump.buffer[localIdx]!, forwarder);
        forwarder.pos++;
      }
      if (pump.done) {
        return;
      }
      await new Promise<void>((resolve) => {
        const settle = (): void => {
          forwarder.wake = undefined;
          pump.waiters.delete(settle);
          resolve();
        };
        forwarder.wake = settle;
        pump.waiters.add(settle);
      });
    }
  } finally {
    unregisterPumpForwarder(pump, forwarder);
    const cState = clients.get(conn.clientId);
    if (cState?.forwarders.get(sessionId) === forwarder) {
      cState.forwarders.delete(sessionId);
    }
  }
}

/** Map a single {@link AgentEvent} to AHP action notifications on the wire. */
export function emitActionsForEvent(
  conn: AhpServerConnection,
  sessionId: string,
  event: AgentEvent,
  forwarder: ForwarderState,
): void {
  const idx = forwarder.mapperContext.eventIndex++;
  const normalized = {
    type: event.type,
    content: event.content,
    toolCallId: event.toolCallId,
    turnId: event.turnId,
    diagnostic: event.diagnostic,
    toolError: event.toolError,
    timestamp: event.timestamp,
    raw: event.raw !== undefined ? JSON.stringify(event.raw) : undefined,
  };

  // TEMPORARY HR8d tunnel: Grackle's native session status is smuggled through
  // AHP's `_meta` side-channel rather than reconstructed from the action stream.
  // Pass through ANY non-empty status content so new runtime status values aren't
  // silently dropped (#1460). The mapper's own status branches are dead code on
  // the production wire — the forwarder intercepts all statuses here before they
  // reach mapAgentEvent.
  //
  // SUNSET: replace with reducer-derived status reconstruction under epic #1348
  // (specifically sub-issue #1343 "Flatten event-processor onto AHP actions").
  if (event.type === "status" && event.content) {
    forwarder.serverSeq += 1;
    const statusAction: StateAction = {
      type: ActionType.SessionMetaChanged,
      _meta: { status: event.content },
    };
    conn.session.notify("action", {
      channel: sessionChannel(sessionId),
      serverSeq: forwarder.serverSeq,
      action: statusAction,
      origin: undefined,
    });
    return;
  }

  // The mapper now handles orphan-turn synthesis internally (see `withTurn` in
  // ahp-mapper.ts). Content events emitted without an active turn are wrapped in
  // a synthetic `turn-orphan-${index}` turn — no forwarder-side rescue needed.
  const result = mapAgentEvent(normalized, idx, forwarder.mapperContext);

  for (const action of result.actions) {
    forwarder.serverSeq += 1;
    conn.session.notify("action", {
      channel: sessionChannel(sessionId),
      serverSeq: forwarder.serverSeq,
      action,
      origin: undefined,
    });
  }

  const metaSnapshot: Record<string, unknown> = {};
  if (forwarder.mapperContext.metaAccumulator.runtimeSessionId !== undefined) {
    metaSnapshot.runtime_session_id = forwarder.mapperContext.metaAccumulator.runtimeSessionId;
  }
  if (forwarder.mapperContext.metaAccumulator.costMillicents !== undefined) {
    metaSnapshot.cost_millicents = forwarder.mapperContext.metaAccumulator.costMillicents;
  }
  if (forwarder.mapperContext.metaAccumulator.inputTokens !== undefined) {
    metaSnapshot.input_tokens = forwarder.mapperContext.metaAccumulator.inputTokens;
  }
  if (forwarder.mapperContext.metaAccumulator.outputTokens !== undefined) {
    metaSnapshot.output_tokens = forwarder.mapperContext.metaAccumulator.outputTokens;
  }
  if (
    Object.keys(metaSnapshot).length > 0 &&
    !shallowEqualSnapshots(forwarder.lastMetaSnapshot, metaSnapshot)
  ) {
    forwarder.serverSeq += 1;
    const metaAction: StateAction = {
      type: ActionType.SessionMetaChanged,
      _meta: metaSnapshot,
    };
    conn.session.notify("action", {
      channel: sessionChannel(sessionId),
      serverSeq: forwarder.serverSeq,
      action: metaAction,
      origin: undefined,
    });
    forwarder.lastMetaSnapshot = metaSnapshot;
  }
}

/** Shallow-equality check for `_meta` snapshot dedup in the forwarder. */
export function shallowEqualSnapshots(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown>,
): boolean {
  if (a === undefined) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const k of aKeys) {
    if (a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
