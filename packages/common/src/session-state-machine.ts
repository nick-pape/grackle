import { SESSION_STATUS } from "./types.js";
import type { SessionStatus } from "./types.js";

/**
 * Legal session state transitions, encoding the documented lifecycle diagram.
 *
 * Extended from the docs-site diagram with pragmatic additions:
 * pending and suspended sessions must be killable (→ stopped).
 */
export const SESSION_TRANSITIONS: ReadonlyMap<SessionStatus, ReadonlySet<SessionStatus>> = new Map<
  SessionStatus,
  Set<SessionStatus>
>([
  [
    SESSION_STATUS.PENDING,
    new Set<SessionStatus>([SESSION_STATUS.RUNNING, SESSION_STATUS.STOPPED]),
  ],
  [
    SESSION_STATUS.RUNNING,
    new Set<SessionStatus>([SESSION_STATUS.IDLE, SESSION_STATUS.STOPPED, SESSION_STATUS.SUSPENDED]),
  ],
  [
    SESSION_STATUS.IDLE,
    new Set<SessionStatus>([
      SESSION_STATUS.RUNNING,
      SESSION_STATUS.STOPPED,
      SESSION_STATUS.SUSPENDED,
    ]),
  ],
  [SESSION_STATUS.STOPPED, new Set<SessionStatus>([])],
  [
    SESSION_STATUS.SUSPENDED,
    new Set<SessionStatus>([SESSION_STATUS.RUNNING, SESSION_STATUS.STOPPED]),
  ],
]);

/** Whether transitioning from `from` to `to` is legal per the session lifecycle. */
export function isValidTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) {
    return true;
  }
  return SESSION_TRANSITIONS.get(from)?.has(to) ?? false;
}

/** Thrown when code attempts an illegal session state transition. */
export class InvalidSessionTransitionError extends Error {
  public readonly from: SessionStatus;
  public readonly to: SessionStatus;

  public constructor(from: SessionStatus, to: SessionStatus) {
    super(`Invalid session state transition: ${from} → ${to}`);
    this.name = "InvalidSessionTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Assert that transitioning from `from` to `to` is legal.
 * Same-state transitions are no-ops. Illegal transitions throw
 * {@link InvalidSessionTransitionError}.
 */
export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (from === to) {
    return;
  }
  if (!SESSION_TRANSITIONS.get(from)?.has(to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
}
