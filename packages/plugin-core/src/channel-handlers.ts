import { create } from "@bufbuild/protobuf";
import { grackle, ValidationError } from "@grackle-ai/common";
import { getDatabaseStores, type ChannelGrantRow } from "@grackle-ai/database";
import { createChannelToken, verifyChannelToken } from "@grackle-ai/auth";
import { ulid } from "ulid";
import { getChannelConfig } from "./channel-config.js";
import { requireChannelGrant, requireSession } from "./require-helpers.js";

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
export async function exposeChannel(
  req: grackle.ExposeChannelRequest,
): Promise<grackle.ExposeChannelResponse> {
  const { channelGrantStore } = getDatabaseStores();
  if (req.target.case !== "sessionId" || !req.target.value) {
    throw new ValidationError("sessionId target is required");
  }
  const sessionId = req.target.value;
  requireSession(sessionId);

  const verbs = req.verbs.length > 0 ? req.verbs : [...DEFAULT_VERBS];
  for (const verb of verbs) {
    if (!SUPPORTED_VERBS.has(verb)) {
      throw new ValidationError(`Unsupported verb: ${verb}`);
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
export async function listChannelGrants(
  _req: grackle.ListChannelGrantsRequest,
): Promise<grackle.ChannelGrantList> {
  const { channelGrantStore } = getDatabaseStores();
  const rows = channelGrantStore.listGrants();
  return create(grackle.ChannelGrantListSchema, { grants: rows.map(grantRowToProto) });
}

/** Revoke a channel grant; its webhook token stops working immediately. */
export async function revokeChannelGrant(
  req: grackle.RevokeChannelGrantRequest,
): Promise<grackle.Empty> {
  const { channelGrantStore } = getDatabaseStores();
  requireChannelGrant(req.grantId);
  channelGrantStore.revokeGrant(req.grantId);
  return create(grackle.EmptySchema, {});
}
