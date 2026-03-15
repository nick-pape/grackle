import type { JSX } from "react";
import { useThemeContext } from "../../context/ThemeContext.js";
import { THEMES } from "../../themes.js";
import styles from "./SettingsPanel.module.scss";

/** Appearance settings panel with theme picker and system preference toggle. */
export function AppearancePanel(): JSX.Element {
  const { themeId, resolvedThemeId, setTheme, preferSystem, setPreferSystem } = useThemeContext();

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
              onClick={() => setTheme(t.id)}
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
                      onClick={(e) => { e.stopPropagation(); setPreferSystem(false); setTheme(t.variantLightId!); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setPreferSystem(false); setTheme(t.variantLightId!); } }}
                      aria-label="Light variant"
                      aria-pressed={isSelected && isLight}
                    >&#9788;</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`${styles.variantButton} ${isSelected && !isLight ? styles.variantActive : ""}`}
                      onClick={(e) => { e.stopPropagation(); setPreferSystem(false); setTheme(t.variantDarkId!); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setPreferSystem(false); setTheme(t.variantDarkId!); } }}
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
          onChange={(e) => setPreferSystem(e.target.checked)}
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
