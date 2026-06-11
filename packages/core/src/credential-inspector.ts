/**
 * Pure offline credential expiry inspection.
 *
 * No side effects: derives expiry state from an already-materialized
 * {@link TokenItem} value without reading any file, env var, or network.
 * Contrast with {@link ./credential-materializer.ts}, which reads secrets.
 */
import type { TokenItem } from "./credential-types.js";

/** Clock-skew buffer: treat a credential expiring within this window as already expired. */
const CREDENTIAL_EXPIRY_SKEW_MS: number = 60_000;

/**
 * The expiry state of a credential, as far as is knowable from a purely offline
 * inspection of a credential file. Only the OAuth-file providers (Claude
 * subscription, Codex) carry an embedded, parseable expiry; for every other
 * credential kind (API keys, GitHub/Copilot/Goose tokens) expiry is not knowable
 * offline and inspection returns `"unknown"`.
 *
 * - `valid` — present and not past expiry.
 * - `expired-recoverable` — past expiry but a refresh token is present, so the
 *   runtime transparently refreshes it on launch (not a spawn blocker).
 * - `expired-unrecoverable` — past expiry with no refresh token; re-login required
 *   (the genuine "will 401 deep in the runtime" case worth failing fast on).
 * - `unknown` — expiry is not offline-knowable, or the file shape is unexpected
 *   (fail open: never treated as a blocker).
 */
export type CredentialExpiryState =
  | "valid"
  | "expired-recoverable"
  | "expired-unrecoverable"
  | "unknown";

/**
 * Decode a JWT payload **without verifying its signature**, returning the parsed
 * claims or `undefined` when the token is not a well-formed three-segment JWT.
 * Offline only — we trust the locally stored file and only read the `exp` claim.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return undefined;
  }
  try {
    const json = Buffer.from(segments[1], "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Inspect a Claude subscription credentials file (`~/.claude/.credentials.json`):
 * the OAuth access token's `expiresAt` is a unix-ms timestamp sibling to a
 * `refreshToken`. Fails open (`"unknown"`) on any unexpected shape.
 */
function inspectClaudeCredentials(value: string, now: number): CredentialExpiryState {
  let oauth: { expiresAt?: unknown; refreshToken?: unknown; accessToken?: unknown } | undefined;
  try {
    // A non-object parse (`null`, a primitive) throws on property access and is
    // caught below, yielding "unknown" — exactly the fail-open behavior we want.
    const parsed = JSON.parse(value) as { claudeAiOauth?: typeof oauth };
    oauth = parsed.claudeAiOauth;
  } catch {
    return "unknown";
  }
  if (!oauth || typeof oauth.accessToken !== "string" || typeof oauth.expiresAt !== "number") {
    return "unknown";
  }
  if (oauth.expiresAt >= now + CREDENTIAL_EXPIRY_SKEW_MS) {
    return "valid";
  }
  return typeof oauth.refreshToken === "string" && oauth.refreshToken.length > 0
    ? "expired-recoverable"
    : "expired-unrecoverable";
}

/**
 * Inspect a Codex auth file (`~/.codex/auth.json`): `tokens.access_token` is a
 * JWT whose `exp` claim (unix seconds) carries the expiry, sibling to a
 * `refresh_token`. Fails open (`"unknown"`) on any unexpected shape — the token
 * format is owned by the Codex runtime and may drift.
 */
function inspectCodexAuth(value: string, now: number): CredentialExpiryState {
  let tokens: { access_token?: unknown; refresh_token?: unknown } | undefined;
  try {
    const parsed = JSON.parse(value) as { tokens?: typeof tokens };
    tokens = parsed.tokens;
  } catch {
    return "unknown";
  }
  if (!tokens || typeof tokens.access_token !== "string") {
    return "unknown";
  }
  const exp = decodeJwtPayload(tokens.access_token)?.exp;
  if (typeof exp !== "number") {
    return "unknown";
  }
  if (exp * 1000 >= now + CREDENTIAL_EXPIRY_SKEW_MS) {
    return "valid";
  }
  return typeof tokens.refresh_token === "string" && tokens.refresh_token.length > 0
    ? "expired-recoverable"
    : "expired-unrecoverable";
}

/**
 * Determine the offline-knowable {@link CredentialExpiryState} of a materialized
 * credential {@link TokenItem}. Only OAuth-file tokens (`claude-credentials`,
 * `codex-auth`) carry a parseable expiry; every other token returns `"unknown"`
 * because expiry is not derivable without a network call. Pure; fails open.
 */
export function inspectFileCredentialExpiry(token: TokenItem, now: number): CredentialExpiryState {
  if (token.type !== "file") {
    return "unknown";
  }
  switch (token.name) {
    case "claude-credentials": {
      return inspectClaudeCredentials(token.value, now);
    }
    case "codex-auth": {
      return inspectCodexAuth(token.value, now);
    }
    default: {
      return "unknown";
    }
  }
}
