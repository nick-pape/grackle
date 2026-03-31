/**
 * Session picker dialog for forwarding messages.
 *
 * Displays a filterable list of active sessions (excluding the current one)
 * so the user can choose a target for a forwarded message.
 * Pure presentational component -- no useGrackle().
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { X, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Session, Environment, PersonaData } from "../../hooks/types.js";
import { ICON_SM, ICON_MD } from "../../utils/iconSize.js";
import styles from "./SessionPicker.module.scss";

/** A session entry enriched with its environment display name. */
export interface SessionPickerEntry {
  /** The session. */
  session: Session;
  /** Display name of the session's environment. */
  environmentName: string;
}

/** Props for the SessionPicker component. */
export interface SessionPickerProps {
  /** Whether the picker is visible. */
  isOpen: boolean;
  /** Active sessions to display (already filtered: active status, not current session). */
  sessions: Session[];
  /** Environments for name lookup. */
  environments: Environment[];
  /** Personas for name lookup (optional — persona name is shown when available). */
  personas?: PersonaData[];
  /** Called when the user selects a target session. */
  onSelect: (sessionId: string) => void;
  /** Called when the user dismisses the picker without selecting. */
  onCancel: () => void;
}

/** Returns a short status badge label for a session. */
function statusLabel(status: string): string {
  if (status === "running") {
    return "running";
  }
  if (status === "idle") {
    return "idle";
  }
  return status;
}

/**
 * Modal dialog listing active sessions for the forward-message feature.
 *
 * The list is filterable by environment name or prompt snippet. If there are
 * no active sessions the picker is not rendered (parent should keep it closed).
 */
export function SessionPicker({
  isOpen,
  sessions,
  environments,
  personas,
  onSelect,
  onCancel,
}: SessionPickerProps): JSX.Element {
  const [filter, setFilter] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the dialog when it opens so Escape is reliably captured
  useEffect(() => {
    if (isOpen) {
      // Filter input has autoFocus when shown; otherwise fall back to close button
      if (sessions.length <= 4) {
        closeButtonRef.current?.focus();
      }
    }
  }, [isOpen, sessions.length]);

  // Build lookup for environment names
  const envNameById = new Map<string, string>(
    environments.map((e) => [e.id, e.displayName]),
  );

  // Build lookup for persona names
  const personaNameById = new Map<string, string>(
    (personas ?? []).map((p) => [p.id, p.name]),
  );

  const entries: SessionPickerEntry[] = sessions.map((s) => ({
    session: s,
    environmentName: envNameById.get(s.environmentId) ?? s.environmentId,
  }));

  const showFilter = sessions.length > 4;

  const filtered = filter.trim()
    ? entries.filter(
        ({ session, environmentName }) =>
          environmentName.toLowerCase().includes(filter.toLowerCase()) ||
          session.prompt.toLowerCase().includes(filter.toLowerCase()),
      )
    : entries;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
          onKeyDown={(e) => { if (e.key === "Escape") { onCancel(); } }}
          role="dialog"
          aria-modal="true"
          aria-label="Forward to session"
          data-testid="session-picker-overlay"
        >
          <motion.div
            ref={dialogRef}
            className={styles.dialog}
            initial={{ opacity: 0, scale: 0.93, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: -10 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => { e.stopPropagation(); }}
            data-testid="session-picker-dialog"
          >
            <div className={styles.header}>
              <h3 className={styles.title}>Forward to session</h3>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.closeButton}
                onClick={onCancel}
                aria-label="Close session picker"
                data-testid="session-picker-close"
              >
                <X size={ICON_SM} aria-hidden="true" />
              </button>
            </div>

            {showFilter && (
              <div className={styles.filterRow}>
                <Search size={ICON_SM} className={styles.searchIcon} aria-hidden="true" />
                <input
                  type="text"
                  className={styles.filterInput}
                  placeholder="Filter sessions..."
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); }}
                  data-testid="session-picker-filter"
                  autoFocus
                />
              </div>
            )}

            {sessions.length === 0 ? (
              <div className={styles.noSessions} data-testid="session-picker-no-sessions">
                <Search size={ICON_MD} aria-hidden="true" />
                <p>No active sessions to forward to.</p>
              </div>
            ) : (
              <ul className={styles.list} data-testid="session-picker-list">
                {filtered.length === 0 ? (
                  <li className={styles.emptyItem} data-testid="session-picker-empty">
                    No matching sessions
                  </li>
                ) : (
                  filtered.map(({ session, environmentName }) => {
                    const personaName = session.personaId
                      ? (personaNameById.get(session.personaId) ?? undefined)
                      : undefined;
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          className={styles.sessionRow}
                          onClick={() => { onSelect(session.id); }}
                          data-testid={`session-picker-item-${session.id}`}
                        >
                          <div className={styles.sessionMain}>
                            <span className={styles.envName}>{environmentName}</span>
                            {personaName !== undefined && (
                              <span className={styles.personaName} data-testid={`session-picker-persona-${session.id}`}>
                                {personaName}
                              </span>
                            )}
                            <span
                              className={`${styles.statusBadge} ${styles[`status_${session.status}`] ?? styles.status_other}`}
                              data-testid={`session-picker-status-${session.id}`}
                            >
                              {statusLabel(session.status)}
                            </span>
                          </div>
                          <div className={styles.sessionPrompt}>
                            {session.prompt.length > 80
                              ? `${session.prompt.slice(0, 80)}...`
                              : session.prompt}
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
