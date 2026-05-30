/**
 * Pure view-model helpers for the Sessions activity monitor.
 *
 * All branchy logic (status normalization, filtering, grouping, sorting, and
 * filter-chip derivation) lives here so it can be unit-tested directly. The
 * SessionsTable component is intentionally kept to straight-line JSX that
 * consumes these helpers.
 *
 * @module
 */

import type { Environment, Session } from "../../hooks/types.js";
import { capitalize } from "../../utils/sessionStatus.js";

/**
 * A normalized status "tone": a small, stable set of buckets that both the raw
 * database session statuses and the live-event mapped statuses collapse into.
 * Drives colour, iconography, and filtering.
 *
 * This is intentionally distinct from {@link ../../utils/sessionStatus.js}'s
 * `sessionStatusStyle`, which the Coordination graph uses: that mapping
 * de-emphasizes finished sessions (completed -> neutral grey) and has no
 * `pending`/`paused`/endReason concepts. The Sessions activity monitor instead
 * wants a richer, success-positive palette (completed -> green) plus the extra
 * buckets that drive its status filter chips, so the two are kept separate by
 * design rather than unified.
 */
export type StatusTone =
  | "running"
  | "idle"
  | "pending"
  | "success"
  | "error"
  | "paused"
  | "neutral";

/** A human-readable description of a session's status. */
export interface SessionStatusDescriptor {
  /** Normalized tone bucket used for colour/icon/filter. */
  tone: StatusTone;
  /** Capitalized display label (e.g. "Running", "Completed"). */
  label: string;
}

/** Tones considered "active" (the session is live, not finished or paused). */
const ACTIVE_TONES: ReadonlySet<StatusTone> = new Set<StatusTone>(["running", "idle", "pending"]);

/** Display order for status filter chips and grouping. */
export const TONE_ORDER: readonly StatusTone[] = [
  "running",
  "idle",
  "pending",
  "success",
  "paused",
  "error",
  "neutral",
];

/** Category labels for status filter chips (broader than per-status labels). */
export const TONE_LABELS: Readonly<Record<StatusTone, string>> = {
  running: "Running",
  idle: "Idle",
  pending: "Pending",
  success: "Completed",
  paused: "Paused",
  error: "Failed",
  neutral: "Other",
};

/**
 * Describe a terminal ("stopped") session by its `endReason`.
 *
 * Sessions reach a generic `stopped` status via live status events; the
 * `endReason` distinguishes a clean completion from an error/kill.
 */
function describeStopped(endReason: string | undefined): SessionStatusDescriptor {
  // Cases mirror grackle.END_REASON. A non-clean stop (killed/interrupted/
  // terminated/budget_exceeded/error) is an error tone so it lands in the
  // "Failed" filter bucket rather than the neutral "Stopped" fallback.
  switch (endReason) {
    case "completed":
      return { tone: "success", label: "Completed" };
    case "killed":
      return { tone: "error", label: "Killed" };
    case "interrupted":
      return { tone: "error", label: "Interrupted" };
    case "terminated":
      return { tone: "error", label: "Terminated" };
    case "budget_exceeded":
      return { tone: "error", label: "Budget exceeded" };
    case "error":
      return { tone: "error", label: "Error" };
    default:
      return { tone: "neutral", label: "Stopped" };
  }
}

/**
 * Map a session's raw status (and `endReason`) to a normalized tone + label.
 *
 * Handles both the raw database statuses returned by `ListSessions`
 * (`running`, `completed`, `failed`, ...) and the collapsed `stopped` status
 * produced by live status events (disambiguated via `endReason`).
 */
export function describeSessionStatus(
  session: Pick<Session, "status" | "endReason">,
): SessionStatusDescriptor {
  switch (session.status) {
    case "running":
      return { tone: "running", label: "Running" };
    case "idle":
    case "waiting_input":
      return { tone: "idle", label: "Idle" };
    case "pending":
      return { tone: "pending", label: "Pending" };
    case "suspended":
      return { tone: "paused", label: "Suspended" };
    case "hibernating":
      return { tone: "paused", label: "Hibernating" };
    case "completed":
      return { tone: "success", label: "Completed" };
    case "failed":
      return { tone: "error", label: "Failed" };
    case "killed":
      return { tone: "error", label: "Killed" };
    case "interrupted":
      return { tone: "error", label: "Interrupted" };
    case "terminated":
      return { tone: "error", label: "Terminated" };
    case "stopped":
      return describeStopped(session.endReason);
    default:
      return { tone: "neutral", label: capitalize(session.status) || "Unknown" };
  }
}

/** Whether a tone represents a live (active) session. */
export function isActiveTone(tone: StatusTone): boolean {
  return ACTIVE_TONES.has(tone);
}

/** Whether a session is currently active (live), by its normalized tone. */
export function isActiveSession(session: Pick<Session, "status" | "endReason">): boolean {
  return isActiveTone(describeSessionStatus(session).tone);
}

/** A status filter selection: a specific tone, or `"all"` for no filter. */
export type StatusFilter = StatusTone | "all";

/** A single status filter chip with its display label and matching count. */
export interface StatusChip {
  /** Filter value this chip selects. */
  value: StatusFilter;
  /** Display label. */
  label: string;
  /** Number of sessions matching this chip. */
  count: number;
}

/**
 * Build the ordered list of status filter chips for a set of sessions.
 *
 * Always begins with an "All" chip, followed by one chip per tone that is
 * actually present (in {@link TONE_ORDER}), each annotated with its count.
 * Chips for absent tones are omitted so the bar stays uncluttered.
 */
export function buildStatusChips(sessions: readonly Session[]): StatusChip[] {
  const counts = new Map<StatusTone, number>();
  for (const session of sessions) {
    const { tone } = describeSessionStatus(session);
    counts.set(tone, (counts.get(tone) ?? 0) + 1);
  }
  const chips: StatusChip[] = [{ value: "all", label: "All", count: sessions.length }];
  for (const tone of TONE_ORDER) {
    const count = counts.get(tone);
    if (count !== undefined && count > 0) {
      chips.push({ value: tone, label: TONE_LABELS[tone], count });
    }
  }
  return chips;
}

/**
 * Whether a session matches a free-text query, checked against its prompt,
 * runtime, id, task id, and resolved environment name. An empty query matches
 * everything. Matching is case-insensitive.
 */
export function sessionMatchesQuery(
  session: Session,
  query: string,
  environmentName: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return true;
  }
  const haystack = [
    session.prompt,
    session.runtime,
    session.id,
    session.taskId ?? "",
    environmentName,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(trimmed);
}

/**
 * Apply the status-tone filter and free-text query to a list of sessions.
 *
 * @param sessions - Sessions to filter.
 * @param status - Selected status filter, or `"all"`.
 * @param query - Free-text query (empty string matches all).
 * @param environmentNameById - Map of environment id to display name, used for
 *   both query matching and so a missing environment falls back to its id.
 */
export function filterSessions(
  sessions: readonly Session[],
  status: StatusFilter,
  query: string,
  environmentNameById: ReadonlyMap<string, string>,
): Session[] {
  return sessions.filter((session) => {
    if (status !== "all" && describeSessionStatus(session).tone !== status) {
      return false;
    }
    const environmentName = environmentNameById.get(session.environmentId) ?? session.environmentId;
    return sessionMatchesQuery(session, query, environmentName);
  });
}

/** A group of sessions belonging to a single environment. */
export interface SessionGroup {
  /** Environment id this group is keyed by. */
  environmentId: string;
  /** The environment, if it still exists (may be undefined for a gone env). */
  environment: Environment | undefined;
  /** Sessions in this group, newest first. */
  sessions: Session[];
  /** Number of active (live) sessions in this group. */
  activeCount: number;
  /** ISO timestamp of the most recently started session in this group. */
  latestStartedAt: string;
}

/** Compare two ISO timestamps for a newest-first sort. */
function byNewest(a: string, b: string): number {
  return b.localeCompare(a);
}

/**
 * Group sessions by their environment, returning groups ready for display.
 *
 * Within each group, sessions are ordered newest-first. Groups are ordered so
 * that those with active sessions appear first, then by most-recent activity,
 * with a stable alphabetical tie-break on environment name. Environments with
 * no sessions are not represented (this is a session inventory, not an env
 * list); environments that no longer exist still get a group keyed by id.
 */
export function groupSessionsByEnvironment(
  sessions: readonly Session[],
  environments: readonly Environment[],
): SessionGroup[] {
  const environmentById = new Map<string, Environment>(environments.map((e) => [e.id, e]));
  const byEnvironment = new Map<string, Session[]>();
  for (const session of sessions) {
    const existing = byEnvironment.get(session.environmentId);
    if (existing) {
      existing.push(session);
    } else {
      byEnvironment.set(session.environmentId, [session]);
    }
  }

  const groups: SessionGroup[] = [];
  for (const [environmentId, groupSessions] of byEnvironment) {
    const sorted = [...groupSessions].sort((a, b) => byNewest(a.startedAt, b.startedAt));
    const activeCount = sorted.filter((s) => isActiveSession(s)).length;
    // `sorted` is newest-first, so the head is the most recently started.
    const latestStartedAt = sorted[0]?.startedAt ?? "";
    groups.push({
      environmentId,
      environment: environmentById.get(environmentId),
      sessions: sorted,
      activeCount,
      latestStartedAt,
    });
  }

  const nameOf = (group: SessionGroup): string =>
    group.environment?.displayName ?? group.environmentId;

  return groups.sort((a, b) => {
    const aActive = a.activeCount > 0 ? 1 : 0;
    const bActive = b.activeCount > 0 ? 1 : 0;
    if (aActive !== bActive) {
      return bActive - aActive;
    }
    const byActivity = byNewest(a.latestStartedAt, b.latestStartedAt);
    if (byActivity !== 0) {
      return byActivity;
    }
    return nameOf(a).localeCompare(nameOf(b));
  });
}
