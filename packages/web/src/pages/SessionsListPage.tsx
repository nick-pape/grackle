/**
 * Sessions activity-monitor page.
 *
 * The discovery surface for every session — task-bound and ad-hoc alike —
 * grouped by environment. Page-level component: owns the `useGrackle()` data
 * fetch and navigation; rendering lives in the presentational
 * {@link SessionsTable}.
 */

import { useMemo, type JSX } from "react";
import {
  SessionsTable,
  PageHeader,
  buildSessionsListBreadcrumbs,
  isActiveSession,
  sessionUrl,
  taskUrl,
  useAppNavigate,
} from "@grackle-ai/web-components";
import { useGrackle } from "../context/GrackleContext.js";
import { buildSummary } from "./sessionsSummary.js";
import styles from "./SessionsListPage.module.scss";

/** The Sessions tab — a live, environment-grouped table of all sessions. */
export function SessionsListPage(): JSX.Element {
  const {
    sessions: { sessions },
    environments: { environments },
    tasks: { tasks },
    personas: { personas },
  } = useGrackle();
  const navigate = useAppNavigate();

  // The sessions domain hook loads on connect and merges live status events, so
  // the list stays current without a page-level refetch. Drop entries with no
  // environment: a `status` event for a not-yet-loaded session id inserts a
  // placeholder with an empty environmentId, which would otherwise render as a
  // blank, nameless environment group until the next list refresh.
  const displayedSessions = useMemo(
    () => sessions.filter((s) => s.environmentId !== ""),
    [sessions],
  );
  const activeCount = useMemo(
    () => displayedSessions.filter((s) => isActiveSession(s)).length,
    [displayedSessions],
  );
  const environmentCount = useMemo(
    () => new Set(displayedSessions.map((s) => s.environmentId)).size,
    [displayedSessions],
  );

  return (
    <div className={styles.page} data-testid="sessions-page">
      <PageHeader segments={buildSessionsListBreadcrumbs()} />
      <header className={styles.header}>
        <h1 className={styles.title}>Sessions</h1>
        <p className={styles.subtitle} data-testid="sessions-summary">
          {buildSummary(displayedSessions.length, activeCount, environmentCount)}
        </p>
      </header>
      <div className={styles.tableWrap}>
        <SessionsTable
          sessions={displayedSessions}
          environments={environments}
          tasks={tasks}
          personas={personas}
          onOpenSession={(id) => navigate(sessionUrl(id))}
          onOpenTask={(taskId) => navigate(taskUrl(taskId))}
        />
      </div>
    </div>
  );
}
