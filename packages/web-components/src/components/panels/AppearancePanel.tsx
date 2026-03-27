import type { JSX } from "react";
import { THEMES } from "../../themes.js";
import styles from "./SettingsPanel.module.scss";

/** Props for the AppearancePanel component. */
export interface AppearancePanelProps {
  /** The user's chosen theme ID. */
  themeId: string;
  /** The resolved data-theme value after system preference. */
  resolvedThemeId: string;
  /** Set a new theme by ID. */
  onSetTheme: (nextId: string) => void;
  /** Whether the theme follows the OS light/dark preference. */
  preferSystem: boolean;
  /** Toggle the OS preference behavior. */
  onSetPreferSystem: (prefer: boolean) => void;
}

/** Appearance settings panel with theme picker and system preference toggle. */
export function AppearancePanel({ themeId, resolvedThemeId, onSetTheme, preferSystem, onSetPreferSystem }: AppearancePanelProps): JSX.Element {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Appearance</h3>
      <p className={styles.sectionDescription}>
        Choose how Grackle looks across the app.
      </p>
      <div className={styles.themeOptions}>
        {THEMES.filter((t) => !t.hidden).map((t) => {
          const hasVariants = !!(t.variantLightId && t.variantDarkId);
          const isSelected = hasVariants
            ? (themeId === t.id || themeId === t.variantLightId || themeId === t.variantDarkId)
            : themeId === t.id;
          const isLight = hasVariants && resolvedThemeId === t.variantLightId;
          return (
            <button
              key={t.id}
              type="button"
              className={`${styles.themeOption} ${isSelected ? styles.themeOptionSelected : ""}`}
              aria-pressed={isSelected}
              onClick={() => onSetTheme(t.id)}
            >
              <span className={styles.themeOptionHeader}>
                <span>
                  <span className={styles.themeOptionLabel}>{t.label}</span>
                  <span className={styles.themeOptionDesc}>{t.description}</span>
                </span>
                {hasVariants && (
                  <span className={styles.variantToggle}>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`${styles.variantButton} ${isSelected && isLight ? styles.variantActive : ""}`}
                      onClick={(e) => { e.stopPropagation(); onSetPreferSystem(false); onSetTheme(t.variantLightId!); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSetPreferSystem(false); onSetTheme(t.variantLightId!); } }}
                      aria-label="Light variant"
                      aria-pressed={isSelected && isLight}
                    >&#9788;</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`${styles.variantButton} ${isSelected && !isLight ? styles.variantActive : ""}`}
                      onClick={(e) => { e.stopPropagation(); onSetPreferSystem(false); onSetTheme(t.variantDarkId!); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSetPreferSystem(false); onSetTheme(t.variantDarkId!); } }}
                      aria-label="Dark variant"
                      aria-pressed={isSelected && !isLight}
                    >&#9790;</span>
                  </span>
                )}
              </span>
              {t.swatches && (
                <span className={styles.themeSwatches}>
                  {t.swatches.map((color, i) => (
                    <span key={i} className={styles.themeSwatch} style={{ background: color }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className={styles.systemToggle}>
        <input
          type="checkbox"
          checked={preferSystem}
          onChange={(e) => onSetPreferSystem(e.target.checked)}
        />
        <span>Match system light/dark preference</span>
      </label>
      <p className={styles.systemToggleHint}>
        Automatically switches between light and dark variants when available.
      </p>
      <p className={styles.themeActive}>
        Active theme: <strong>{resolvedThemeId}</strong>
      </p>
    </section>
  );
}
