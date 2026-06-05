/**
 * AHP channel URI encoding/decoding and protocol constants.
 * @module channel-codec
 */

import type { URI } from "@grackle-ai/ahp";

/** AHP protocol version declared in the initialize handshake. */
export const PROTOCOL_VERSION: string = "0.1.0";

/** URI prefix for session channels. */
export const SESSION_CHANNEL_PREFIX: string = "ahp-session:/";

/** URI prefix for resource-watch channels. */
export const RESOURCE_WATCH_CHANNEL_PREFIX: string = "ahp-resource-watch:/";

/**
 * Window over which raw filesystem events are coalesced into a single
 * `resourceWatch/changed` action batch, to keep the action stream tractable
 * under bursty writes (e.g. an editor's atomic save).
 */
export const WATCH_COALESCE_MS: number = 75;

/**
 * Maximum number of concurrent resource watches a single connection may hold.
 * Each subscribed watch consumes OS file-watch descriptors, so this bounds a
 * buggy or hostile client's ability to exhaust them.
 */
export const MAX_RESOURCE_WATCHES_PER_CONNECTION: number = 64;

/**
 * Decode a session URI to its underlying sessionId. Returns undefined for
 * non-session URIs OR for the bare prefix `ahp-session:/` with no id.
 */
export function sessionIdFromChannel(channel: URI): string | undefined {
  if (!channel.startsWith(SESSION_CHANNEL_PREFIX)) {
    return undefined;
  }
  const id = channel.slice(SESSION_CHANNEL_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

/** Encode a sessionId as an AHP session URI. */
export function sessionChannel(sessionId: string): URI {
  return `${SESSION_CHANNEL_PREFIX}${sessionId}`;
}
