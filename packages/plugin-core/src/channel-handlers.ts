import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { channelGrantStore, sessionStore, type ChannelGrantRow } from "@grackle-ai/database";
import { createChannelToken, verifyChannelToken } from "@grackle-ai/auth";
import { ulid } from "ulid";
import { getChannelConfig } from "./channel-config.js";

/** Verbs currently supported on a channel. */
const SUPPORTED_VERBS: ReadonlySet<string> = new Set(["send_input"]);

/** Default verb set when a request omits `verbs`. */
const DEFAULT_VERBS: readonly string[] = ["send_input"];

/** Convert a stored grant row to its proto representation. */
function grantRowToProto(row: ChannelGrantRow): grackle.ChannelGrant {
  return create(grackle.ChannelGrantSchema, {
    grantId: row.id,
    channelUri: row.channelUri,
    verbs: row.verbs ? row.verbs.split(",") : [],
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? "",
    revoked: row.revoked,
  });
}

/**
 * Mint a capability token exposing a single session channel for inbound
 * user-message injection, and persist a revocable grant.
 *
 * v0 supports session targets only (`grackle:/sessions/<id>`).
 */
export async function exposeChannel(req: grackle.ExposeChannelRequest): Promise<grackle.ExposeChannelResponse> {
  if (req.target.case !== "sessionId" || !req.target.value) {
    throw new ConnectError("a session_id target is required", Code.InvalidArgument);
  }
  const sessionId = req.target.value;
  if (!sessionStore.getSession(sessionId)) {
    throw new ConnectError(`Session not found: ${sessionId}`, Code.NotFound);
  }

  const verbs = req.verbs.length > 0 ? req.verbs : [...DEFAULT_VERBS];
  for (const verb of verbs) {
    if (!SUPPORTED_VERBS.has(verb)) {
      throw new ConnectError(`Unsupported verb: ${verb}`, Code.InvalidArgument);
    }
  }

  const channelUri = `grackle:/sessions/${sessionId}`;
  const grantId = ulid();
  const { signingSecret, ingressBaseUrl } = getChannelConfig();
  const ttlMs = req.ttlSeconds > 0 ? req.ttlSeconds * 1000 : undefined;
  const token = createChannelToken({ chan: channelUri, verbs, jti: grantId }, signingSecret, ttlMs);

  // Decode the freshly-minted token to read its expiry without duplicating TTL logic.
  const claims = verifyChannelToken(token, signingSecret);
  const expiresAt = claims ? new Date(claims.exp * 1000).toISOString() : "";

  channelGrantStore.createGrant(grantId, channelUri, verbs.join(","), req.label, expiresAt || null);

  return create(grackle.ExposeChannelResponseSchema, {
    channelUri,
    grantId,
    token,
    ingressUrl: `${ingressBaseUrl}/hook/${token}`,
    expiresAt,
  });
}

/** List all channel grants. */
export async function listChannelGrants(_req: grackle.ListChannelGrantsRequest): Promise<grackle.ChannelGrantList> {
  const rows = channelGrantStore.listGrants();
  return create(grackle.ChannelGrantListSchema, { grants: rows.map(grantRowToProto) });
}

/** Revoke a channel grant; its webhook token stops working immediately. */
export async function revokeChannelGrant(req: grackle.RevokeChannelGrantRequest): Promise<grackle.Empty> {
  if (!req.grantId) {
    throw new ConnectError("grant_id is required", Code.InvalidArgument);
  }
  if (!channelGrantStore.getGrant(req.grantId)) {
    throw new ConnectError(`grant not found: ${req.grantId}`, Code.NotFound);
  }
  channelGrantStore.revokeGrant(req.grantId);
  return create(grackle.EmptySchema, {});
}
