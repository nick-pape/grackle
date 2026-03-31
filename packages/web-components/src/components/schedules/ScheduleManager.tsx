import { useState, useMemo, type JSX } from "react";
import type { PersonaData, ScheduleData, ScheduleUpdate } from "../../hooks/types.js";
import { Button } from "../display/Button.js";
import { ConfirmDialog } from "../display/index.js";
import { formatRelativeTime, formatCountdown } from "../../utils/time.js";
import styles from "./ScheduleManager.module.scss";

/** Props for the ScheduleManager component. */
export interface ScheduleManagerProps {
  /** All schedules. */
  schedules: ScheduleData[];
  /** All personas — used to resolve persona names. */
  personas: PersonaData[];
  /** Callback to delete a schedule. */
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  /** Callback to toggle a schedule's enabled state. */
  onToggleEnabled: (scheduleId: string, fields: ScheduleUpdate) => Promise<unknown>;
  /** Navigate to the new schedule page. */
  onNavigateToNew: () => void;
  /** Navigate to a schedule's detail page for editing. */
  onNavigateToSchedule: (scheduleId: string) => void;
}

/** Schedule list view — shows cards and navigates to detail pages for create/edit. */
export function ScheduleManager({
  schedules, personas,
  onDeleteSchedule, onToggleEnabled,
  onNavigateToNew, onNavigateToSchedule,
}: ScheduleManagerProps): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scheduleToDelete = confirmDelete ? schedules.find((s) => s.id === confirmDelete) : undefined;

  const handleDelete = async (id: string): Promise<void> => {
    await onDeleteSchedule(id);
    setConfirmDelete(null);
  };

  const personaNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) {
      map.set(p.id, p.name);
    }
    return map;
  }, [personas]);

  const resolvePersonaName = (personaId: string): string => personaNameMap.get(personaId) ?? personaId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Schedules</h2>
        <Button variant="primary" size="md" onClick={onNavigateToNew} data-testid="schedule-new-button">
          + New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <p className={styles.empty} data-testid="schedule-empty-state">
          No schedules yet. Create one to run tasks on a recurring cadence.
        </p>
      ) : (
        <div className={styles.list}>
          {schedules.map((s) => (
            <div
              key={s.id}
              className={styles.card}
              data-testid={`schedule-card-${s.id}`}
              onClick={() => onNavigateToSchedule(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.currentTarget === e.target && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onNavigateToSchedule(s.id);
                }
              }}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>
                  <strong>{s.title}</strong>
                  <span
                    className={`${styles.statusBadge} ${s.enabled ? styles.enabled : styles.disabled}`}
                    data-testid={`schedule-status-badge-${s.id}`}
                  >
                    {s.enabled ? "Enabled" : "Disabled"}
                  </span>
                </span>
                <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const toggle = async (): Promise<void> => { await onToggleEnabled(s.id, { enabled: !s.enabled }); };
                      toggle().catch(() => undefined);
                    }}
                    data-testid={`schedule-toggle-${s.id}`}
                    title={s.enabled ? "Disable schedule" : "Enable schedule"}
                  >
                    {s.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onNavigateToSchedule(s.id)}
                    data-testid={`schedule-edit-${s.id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(s.id)}
                    data-testid={`schedule-delete-${s.id}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div className={styles.cardMeta}>
                <span data-testid={`schedule-expression-${s.id}`}>{s.scheduleExpression}</span>
                {s.personaId && (
                  <span data-testid={`schedule-persona-${s.id}`}>
                    Persona: {resolvePersonaName(s.personaId)}
                  </span>
                )}
                <span data-testid={`schedule-last-run-${s.id}`}>
                  Last run: {s.lastRunAt ? formatRelativeTime(s.lastRunAt) : "Never"}
                </span>
                {s.enabled && s.nextRunAt ? (
                  <span data-testid={`schedule-next-run-${s.id}`}>
                    Next run: {formatCountdown(s.nextRunAt)}
                  </span>
                ) : null}
                {s.runCount > 0 && (
                  <span data-testid={`schedule-run-count-${s.id}`}>
                    Runs: {s.runCount}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete Schedule?"
        description={`"${scheduleToDelete?.title ?? ""}" will be permanently removed. Tasks already created by this schedule will not be affected.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete) {
            handleDelete(confirmDelete).catch(() => undefined);
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
