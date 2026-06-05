/**
 * AHP subscribe/unsubscribe handlers: session and resource-watch subscriptions.
 * @module handlers/subscribe-handlers
 */

import type { AhpResponse, SubscribeParams, SubscribeResult } from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import type { AhpServerConnection } from "@grackle-ai/ahp-transport";

import type { ClientState, ForwarderState } from "../ahp-types.js";
import { RESOURCE_WATCH_CHANNEL_PREFIX, sessionIdFromChannel } from "../channel-codec.js";
import { runForwarder } from "../forwarder.js";
import { startResourceWatch } from "../resource-watch.js";
import { getSession, isParked } from "../session-mgr.js";

/** Route a subscribe request to either resource-watch or session forwarding. */
export function handleSubscribe(
  params: SubscribeParams,
  conn: AhpServerConnection,
  cState: ClientState,
  clients: Map<string, ClientState>,
): AhpResponse {
  if (params.channel.startsWith(RESOURCE_WATCH_CHANNEL_PREFIX)) {
    const entry = cState.watches.get(params.channel);
    if (entry === undefined) {
      return {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: JsonRpcErrorCodes.InvalidParams,
          message: `Unknown resource-watch channel: ${params.channel}`,
        },
      } satisfies AhpResponse;
    }
    startResourceWatch(conn, params.channel, entry);
    return {
      jsonrpc: "2.0",
      id: 0,
      result: { snapshot: undefined } satisfies SubscribeResult,
    } as AhpResponse;
  }
  return handleSessionSubscribe(params, conn, cState, clients);
}

/** Set up the per-(session, client) forwarder for a session-channel subscribe. */
function handleSessionSubscribe(
  params: SubscribeParams,
  conn: AhpServerConnection,
  cState: ClientState,
  clients: Map<string, ClientState>,
): AhpResponse {
  const sessionId = sessionIdFromChannel(params.channel);
  if (sessionId === undefined) {
    return {
      jsonrpc: "2.0",
      id: 0,
      result: { snapshot: undefined } satisfies SubscribeResult,
    } as AhpResponse;
  }
  const session = getSession(sessionId);
  if (session === undefined && !isParked(sessionId)) {
    return {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: JsonRpcErrorCodes.InvalidParams,
        message: `Unknown session channel: ${params.channel}`,
      },
    } satisfies AhpResponse;
  }

  const prior = cState.forwarders.get(sessionId);
  if (prior !== undefined) {
    prior.cancelled = true;
    prior.wake?.();
  }

  const forwarder: ForwarderState = {
    mapperContext: {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      eventIndex: 0,
      metaAccumulator: {},
    },
    serverSeq: 0,
    cancelled: false,
    lastMetaSnapshot: undefined,
    pos: 0,
  };
  cState.forwarders.set(sessionId, forwarder);

  queueMicrotask(() => {
    runForwarder(conn, sessionId, forwarder, clients).catch(() => {});
  });

  return {
    jsonrpc: "2.0",
    id: 0,
    result: { snapshot: undefined } satisfies SubscribeResult,
  } as AhpResponse;
}
