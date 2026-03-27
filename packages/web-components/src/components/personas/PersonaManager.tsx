import { useState, type JSX } from "react";
import type { PersonaData } from "../../hooks/types.js";
import { Button } from "../display/Button.js";
import { ConfirmDialog } from "../display/index.js";
import styles from "./PersonaManager.module.scss";

/** Props for the PersonaManager component. */
export interface PersonaManagerProps {
  /** All personas. */
  personas: PersonaData[];
  /** The app-level default persona ID. */
  appDefaultPersonaId: string;
  /** Callback to delete a persona. */
  onDeletePersona: (personaId: string) => Promise<void>;
  /** Callback to set the app-level default persona. */
  onSetAppDefaultPersonaId: (personaId: string) => Promise<void>;
  /** Navigate to the new persona page. */
  onNavigateToNew: () => void;
  /** Navigate to a persona's detail page for editing. */
  onNavigateToPersona: (personaId: string) => void;
}

/** Persona list view — shows cards and navigates to detail pages for create/edit. */
export function PersonaManager({
  personas, appDefaultPersonaId,
  onDeletePersona, onSetAppDefaultPersonaId,
  onNavigateToNew, onNavigateToPersona,
}: PersonaManagerProps): JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const personaToDelete = confirmDelete ? personas.find((p) => p.id === confirmDelete) : undefined;

  const handleDelete = async (id: string): Promise<void> => {
    await onDeletePersona(id);
    setConfirmDelete(null);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Personas</h2>
        <Button variant="primary" size="md" onClick={onNavigateToNew} data-testid="persona-new-button">
          + New Persona
        </Button>
      </div>

      {personas.length === 0 ? (
        <p className={styles.empty}>No personas yet. Create one to get started.</p>
      ) : (
        <div className={styles.list}>
          {personas.map((p) => {
            const isAppDefault = appDefaultPersonaId === p.id;
            const isScript = p.type === "script";
            return (
              <div
                key={p.id}
                className={styles.card}
                data-testid={`persona-card-${p.id}`}
                onClick={() => onNavigateToPersona(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.currentTarget === e.target && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onNavigateToPersona(p.id);
                  }
                }}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    <strong>{p.name}</strong>
                    <span className={styles.typeBadge} data-testid={`persona-type-badge-${p.id}`}>
                      {isScript ? "Script" : "Agent"}
                    </span>
                    {isAppDefault && (
                      <span className={styles.defaultBadge} data-testid={`persona-default-badge-${p.id}`}>App Default</span>
                    )}
                  </span>
                  <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                    {!isAppDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onSetAppDefaultPersonaId(p.id).catch(() => undefined);
                          }}
                          data-testid={`persona-set-default-${p.id}`}
                          title="Set as app default persona"
                        >
                        Set Default
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onNavigateToPersona(p.id)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(p.id)} data-testid={`persona-delete-${p.id}`}>Delete</Button>
                  </div>
                </div>
                {p.description && <p className={styles.description}>{p.description}</p>}
                <div className={styles.meta}>
                  {p.runtime && <span>Runtime: {p.runtime}</span>}
                  {p.model && <span>Model: {p.model}</span>}
                  {p.maxTurns > 0 && <span>Max turns: {p.maxTurns}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Delete Persona?"
        description={`"${personaToDelete?.name ?? ""}" will be permanently removed.`}
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
