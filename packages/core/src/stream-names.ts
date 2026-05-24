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
