/**
 * Sessions activity monitor — a live, environment-grouped table of every
 * session (task-bound and ad-hoc).
 *
 * This is the discovery surface for sessions that aren't reachable through the
 * Tasks tree: ad-hoc `grackle spawn`s, debug sessions, and superseded task
 * attempts. Sessions are grouped under their host environment (the one field
 * every session always has), with the owning task surfaced as a link when
 * present and an `ad-hoc` marker otherwise.
 *
 * Pure presentational component — no `useGrackle()`. All branchy view logic
 * lives in {@link ./sessionsView.js}.
 */

import { useMemo, useState, type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, ClipboardList, Monitor, Search, Terminal } from "lucide-react";
import type { Environment, PersonaData, Session, TaskData } from "../../hooks/types.js";
import { ICON_SM } from "../../utils/iconSize.js";
import { formatCost, formatTokens } from "../../utils/format.js";
import { formatRelativeTime } from "../../utils/time.js";
import {
  buildStatusChips,
  describeSessionStatus,
  filterSessions,
  groupSessionsByEnvironment,
  type SessionGroup,
  type StatusFilter,
} from "./sessionsView.js";
import styles from "./SessionsTable.module.scss";

/** Props for {@link SessionsTable}. */
export interface SessionsTableProps {
  /** All sessions to display (task-bound and ad-hoc). */
  sessions: Session[];
  /** Environments, for group headers and name resolution. */
  environments: Environment[];
  /** Tasks, for resolving task titles on the task chip (optional). */
  tasks?: TaskData[];
  /** Personas, for resolving persona names (optional). */
  personas?: PersonaData[];
  /** Called when a session row is activated. */
  onOpenSession: (sessionId: string) => void;
  /** Called when a session's task chip is activated. */
  onOpenTask: (taskId: string) => void;
}

/** Entrance/exit animation timing for collapsing a group (seconds). */
const COLLAPSE_DURATION_S: number = 0.18;

/** A single session row. */
function SessionRow({
  session,
  taskTitle,
  personaName,
  onOpenSession,
  onOpenTask,
}: {
  session: Session;
  taskTitle: string | undefined;
  personaName: string | undefined;
  onOpenSession: (sessionId: string) => void;
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const status = describeSessionStatus(session);
  const totalTokens = (session.inputTokens ?? 0) + (session.outputTokens ?? 0);
  const cost = session.costMillicents ?? 0;

  // The clickable session area and the task-association control are siblings,
  // not nested, so each is an independent, keyboard-accessible <button> (no
  // invalid nested-interactive ARIA, no key-event double-firing between them).
  return (
    <li
      className={styles.row}
      data-status-tone={status.tone}
      data-testid={`session-row-${session.id}`}
    >
      <button
        type="button"
        className={styles.rowButton}
        aria-label={`Open session: ${session.prompt || session.id}`}
        onClick={() => onOpenSession(session.id)}
        data-testid={`session-open-${session.id}`}
      >
        <span className={styles.statusDot} data-tone={status.tone} aria-hidden="true" />
        <div className={styles.rowContent}>
          <div className={styles.promptLine}>
            <span className={styles.prompt}>
              {session.prompt || <span className={styles.promptEmpty}>(no prompt)</span>}
            </span>
          </div>
          <div className={styles.meta}>
            <span className={styles.statusLabel} data-tone={status.tone}>
              {status.label}
            </span>
            <span className={styles.runtimeBadge}>{session.runtime || "unknown"}</span>
            {personaName !== undefined && (
              <span className={styles.personaBadge} data-testid={`session-persona-${session.id}`}>
                {personaName}
              </span>
            )}
            <span className={styles.time}>{formatRelativeTime(session.startedAt)}</span>
            {totalTokens > 0 && (
              <span className={styles.tokens}>{formatTokens(totalTokens)} tok</span>
            )}
            {cost > 0 && <span className={styles.cost}>{formatCost(cost)}</span>}
          </div>
        </div>
      </button>
      <div className={styles.association}>
        {session.taskId ? (
          <button
            type="button"
            className={styles.taskChip}
            title={taskTitle ?? session.taskId}
            onClick={() => onOpenTask(session.taskId ?? "")}
            data-testid={`session-task-${session.id}`}
          >
            <ClipboardList size={ICON_SM} aria-hidden="true" />
            <span className={styles.taskChipLabel}>{taskTitle ?? session.taskId}</span>
          </button>
        ) : (
          <span className={styles.adHocChip} data-testid={`session-adhoc-${session.id}`}>
            <Terminal size={ICON_SM} aria-hidden="true" />
            ad-hoc
          </span>
        )}
      </div>
    </li>
  );
}

/** A collapsible environment group of sessions. */
function EnvironmentGroup({
  group,
  collapsed,
  onToggle,
  taskTitleById,
  personaNameById,
  onOpenSession,
  onOpenTask,
}: {
  group: SessionGroup;
  collapsed: boolean;
  onToggle: (environmentId: string) => void;
  taskTitleById: Map<string, string>;
  personaNameById: Map<string, string>;
  onOpenSession: (sessionId: string) => void;
  onOpenTask: (taskId: string) => void;
}): JSX.Element {
  const { environment, environmentId } = group;
  const name = environment?.displayName ?? environmentId;

  return (
    <section className={styles.group} data-testid={`session-group-${environmentId}`}>
      <button
        type="button"
        className={styles.groupHeader}
        aria-expanded={!collapsed}
        onClick={() => onToggle(environmentId)}
        data-testid={`session-group-toggle-${environmentId}`}
      >
        {collapsed ? (
          <ChevronRight size={ICON_SM} aria-hidden="true" />
        ) : (
          <ChevronDown size={ICON_SM} aria-hidden="true" />
        )}
        <Monitor size={ICON_SM} className={styles.groupIcon} aria-hidden="true" />
        <span className={styles.groupName}>{name}</span>
        {environment !== undefined ? (
          <span
            className={styles.envStatusDot}
            data-status={environment.status}
            aria-hidden="true"
          />
        ) : (
          <span className={styles.missingEnv}>missing</span>
        )}
        <span className={styles.groupSpacer} />
        {group.activeCount > 0 && (
          <span className={styles.activePill} data-testid={`session-group-active-${environmentId}`}>
            {group.activeCount} active
          </span>
        )}
        <span className={styles.countBadge}>{group.sessions.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul
            className={styles.rows}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: COLLAPSE_DURATION_S, ease: [0.16, 1, 0.3, 1] }}
          >
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                taskTitle={session.taskId ? taskTitleById.get(session.taskId) : undefined}
                personaName={session.personaId ? personaNameById.get(session.personaId) : undefined}
                onOpenSession={onOpenSession}
                onOpenTask={onOpenTask}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * The Sessions activity monitor: a searchable, status-filterable, environment-
 * grouped table of all sessions. Updates live as the parent's session list
 * changes (statuses flow in through the sessions domain hook).
 */
export function SessionsTable({
  sessions,
  environments,
  tasks,
  personas,
  onOpenSession,
  onOpenTask,
}: SessionsTableProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const environmentNameById = useMemo(
    () => new Map(environments.map((e) => [e.id, e.displayName])),
    [environments],
  );
  const taskTitleById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t.title])), [tasks]);
  const personaNameById = useMemo(
    () => new Map((personas ?? []).map((p) => [p.id, p.name])),
    [personas],
  );

  // Chips reflect the full set; filtering narrows what's shown below.
  const chips = useMemo(() => buildStatusChips(sessions), [sessions]);
  const filtered = useMemo(
    () => filterSessions(sessions, statusFilter, query, environmentNameById),
    [sessions, statusFilter, query, environmentNameById],
  );
  const groups = useMemo(
    () => groupSessionsByEnvironment(filtered, environments),
    [filtered, environments],
  );

  const toggleGroup = (environmentId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(environmentId)) {
        next.delete(environmentId);
      } else {
        next.add(environmentId);
      }
      return next;
    });
  };

  return (
    <div className={styles.container} data-testid="sessions-table">
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label="Filter by status">
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`${styles.chip} ${statusFilter === chip.value ? styles.chipActive : ""}`}
              data-tone={chip.value === "all" ? undefined : chip.value}
              aria-pressed={statusFilter === chip.value}
              onClick={() => setStatusFilter(chip.value)}
              data-testid={`session-filter-${chip.value}`}
            >
              {chip.label}
              <span className={styles.chipCount}>{chip.count}</span>
            </button>
          ))}
        </div>
        <div className={styles.search}>
          <Search size={ICON_SM} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search sessions"
            data-testid="sessions-search"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className={styles.empty} data-testid="sessions-empty">
          <Terminal size={32} aria-hidden="true" />
          <p className={styles.emptyTitle}>
            {sessions.length === 0 ? "No sessions yet" : "No matching sessions"}
          </p>
          <p className={styles.emptyHint}>
            {sessions.length === 0
              ? "Spawn an agent or start a task and it will show up here."
              : "Try a different status filter or search term."}
          </p>
        </div>
      ) : (
        <div className={styles.scroll}>
          {groups.map((group) => (
            <EnvironmentGroup
              key={group.environmentId}
              group={group}
              collapsed={collapsed.has(group.environmentId)}
              onToggle={toggleGroup}
              taskTitleById={taskTitleById}
              personaNameById={personaNameById}
              onOpenSession={onOpenSession}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
