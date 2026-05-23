/**
 * Inbound channel message ingestion — the data-plane logic behind the
 * `POST /hook/<token>` webhook. Verifies a capability token, checks the
 * persisted (revocable) grant, then injects the message into the target
 * session via the existing {@link sendInput} handler.
 *
 * @module
 */

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { channelGrantStore } from "@grackle-ai/database";
import { verifyChannelToken } from "@grackle-ai/auth";
import { getChannelConfig } from "./channel-config.js";
import { sendInput } from "./session-handlers.js";

/** Structural result of handling an inbound webhook (mirrors web-server `WebhookResult`). */
export interface IngestResult {
  /** Outcome category (maps to an HTTP status in the web server). */
  outcome: "delivered" | "buffered" | "forbidden" | "not_found" | "unavailable" | "bad_request";
  /** Resolved channel URI, when known. */
  channelUri?: string;
  /** Resolved session ID, when delivered. */
  sessionId?: string;
}

/** Inbound webhook payload (mirrors web-server `WebhookBody`). */
export interface IngestBody {
  message: string;
  from?: string;
  idempotencyKey?: string;
}

const SESSION_CHANNEL_PREFIX: string = "grackle:/sessions/";

/** Max recently-seen idempotency keys to retain (process-local dedupe for v0). */
const MAX_SEEN_KEYS: number = 1000;
const seenKeys: Map<string, number> = new Map();

/** Record an idempotency key; returns true if it was already seen. */
function alreadySeen(key: string): boolean {
  if (seenKeys.has(key)) {
    return true;
  }
  seenKeys.set(key, Date.now());
  if (seenKeys.size > MAX_SEEN_KEYS) {
    const oldest = seenKeys.keys().next().value;
    if (oldest !== undefined) {
      seenKeys.delete(oldest);
    }
  }
  return false;
}

/**
 * Verify a channel capability token and inject the message into its session.
 *
 * @param token - The capability token (from the URL or Bearer header).
 * @param body - The inbound message payload.
 * @returns An {@link IngestResult} the web server maps to an HTTP status.
 */
export async function ingestChannelMessage(token: string, body: IngestBody): Promise<IngestResult> {
  const { signingSecret } = getChannelConfig();

  const claims = verifyChannelToken(token, signingSecret);
  if (!claims) {
    return { outcome: "forbidden" };
  }
  const grant = channelGrantStore.getGrant(claims.jti);
  if (!grant || grant.revoked) {
    return { outcome: "forbidden", channelUri: claims.chan };
  }
  if (!claims.verbs.includes("send_input")) {
    return { outcome: "forbidden", channelUri: claims.chan };
  }
  if (!claims.chan.startsWith(SESSION_CHANNEL_PREFIX)) {
    return { outcome: "bad_request", channelUri: claims.chan };
  }
  const sessionId = claims.chan.slice(SESSION_CHANNEL_PREFIX.length);

  // Dedupe webhook retries (scoped to the grant).
  if (body.idempotencyKey && alreadySeen(`${claims.jti}:${body.idempotencyKey}`)) {
    return { outcome: "delivered", channelUri: claims.chan, sessionId };
  }

  const text = body.from ? `[${body.from}] ${body.message}` : body.message;
  try {
    await sendInput(create(grackle.InputMessageSchema, { sessionId, text }));
    return { outcome: "delivered", channelUri: claims.chan, sessionId };
  } catch (err) {
    if (err instanceof ConnectError) {
      if (err.code === Code.NotFound) {
        return { outcome: "not_found", channelUri: claims.chan };
      }
      if (err.code === Code.FailedPrecondition) {
        return { outcome: "unavailable", channelUri: claims.chan };
      }
    }
    throw err;
  }
}
