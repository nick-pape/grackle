/**
 * PersonaNav — vertical sidebar navigation for the Persona Library.
 *
 * @module
 */

import { useCallback, useRef, type JSX, type KeyboardEvent } from "react";
import { Circle } from "lucide-react";
import { ICON_XS } from "../../utils/iconSize.js";
import { useMatch } from "react-router";
import type { PersonaData } from "../../hooks/types.js";
import { personaUrl, NEW_PERSONA_URL, useAppNavigate } from "../../utils/navigation.js";
import styles from "./PersonaNav.module.scss";

/** Type-indicator color mapping. */
const TYPE_COLORS: Record<string, string> = {
  agent: "var(--accent-green)",
  script: "var(--accent-blue)",
};

/** Props for the PersonaNav component. */
export interface PersonaNavProps {
  /** List of all personas to display in the nav. */
  personas: PersonaData[];
  /** The app-level default persona ID, used to show the "Default" badge. */
  appDefaultPersonaId: string;
}

/** Vertical nav rail listing personas with type indicators. */
export function PersonaNav({ personas, appDefaultPersonaId }: PersonaNavProps): JSX.Element {
  const navigate = useAppNavigate();
  const tabListRef = useRef<HTMLElement>(null);

  const detailMatch = useMatch("/personas/:personaId");
  const rawId = detailMatch?.params.personaId;
  const activeId = rawId === "new" ? undefined : rawId;

  const handleClick = useCallback(
    (personaId: string) => {
      navigate(personaUrl(personaId));
    },
    [navigate],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!buttons || buttons.length === 0) {
        return;
      }
      const focusedIndex = Array.from(buttons).findIndex((b) => b === document.activeElement);
      const currentIndex =
        focusedIndex >= 0 ? focusedIndex : personas.findIndex((p) => p.id === activeId);
      let nextIndex = currentIndex;

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIndex = buttons.length - 1;
      } else {
        return;
      }

      if (nextIndex < personas.length) {
        navigate(personaUrl(personas[nextIndex].id));
      }
      buttons[nextIndex].focus();
    },
    [activeId, personas, navigate],
  );

  const focusableId = activeId ?? (personas.length > 0 ? personas[0].id : undefined);

  return (
    <div className={styles.nav} data-testid="persona-nav">
      <nav
        ref={tabListRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Personas"
        onKeyDown={handleKeyDown}
      >
        {personas.map((persona) => {
          const isActive = persona.id === activeId;
          const isFocusable = persona.id === focusableId;
          const typeColor = TYPE_COLORS[persona.type] || "var(--text-tertiary)";
          const isDefault = persona.id === appDefaultPersonaId;
          return (
            <button
              key={persona.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isFocusable ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => handleClick(persona.id)}
              data-testid="persona-nav-item"
            >
              <span className={styles.typeDot} style={{ color: typeColor }} aria-hidden="true">
                <Circle size={ICON_XS} fill="currentColor" />
              </span>
              <span className={styles.tabLabel} title={persona.name}>
                {persona.name}
              </span>
              {isDefault && (
                <span className={styles.defaultBadge} data-testid="persona-nav-default-badge">
                  Default
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className={styles.addButton}
        onClick={() => navigate(NEW_PERSONA_URL)}
        title="New persona"
        data-testid="persona-nav-add"
      >
        + New Persona
      </button>

      {personas.length === 0 && <div className={styles.empty}>No personas yet.</div>}
    </div>
  );
}
