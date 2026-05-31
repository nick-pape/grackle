/**
 * Canonical IPC stream-name prefixes and helpers.
 *
 * Internal "plumbing" streams use reserved prefixes — they are infrastructure
 * (per-session lifecycle signals, parent/child pipes, stdin), not user-facing
 * conversation rooms. They are hidden from the Coordination surface, rejected as
 * user-supplied stream names, and excluded from the durable observation log
 * (RFC #1264 Phase 2). This is the single source of truth for that boundary.
 *
 * @module
 */

/** Prefix for per-session lifecycle streams. */
export const LIFECYCLE_PREFIX: string = "lifecycle:";

/** Reserved prefixes for internal plumbing streams (not user-facing rooms). */
export const RESERVED_PREFIXES: readonly string[] = ["lifecycle:", "pipe:", "stdin:"];

/**
 * True if `name` is an internal/reserved stream (plumbing) rather than an
 * observable conversation room.
 *
 * @param name - The stream name to test.
 */
export function isReservedStreamName(name: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Prefix for operator (human-driven) principal ids (#1309).
 *
 * This is a *principal id* convention (the `session_id` of a subscription),
 * distinct from {@link RESERVED_PREFIXES}, which gate stream *names*. The
 * operator principal anchors an operator-created room — it holds an `rw`/`detach`
 * subscription so the room survives at zero agents and shows in the roster.
 */
export const OPERATOR_PRINCIPAL_PREFIX: string = "operator:";

/**
 * The default operator principal id. A single well-known server-side principal
 * is sufficient for T1; per-operator identities can layer on later by varying
 * the suffix after {@link OPERATOR_PRINCIPAL_PREFIX}.
 */
export const OPERATOR_PRINCIPAL: string = "operator:default";

/**
 * True if `sessionId` is an operator (human-driven) principal rather than a real
 * agent session. Mirrors the `__server__` pseudo-principal pattern.
 *
 * @param sessionId - The subscription session id to test.
 */
export function isOperatorPrincipal(sessionId: string): boolean {
  return sessionId.startsWith(OPERATOR_PRINCIPAL_PREFIX);
}
