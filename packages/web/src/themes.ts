// ============================================================================
// Theme Registry — Grackle Web UI
// ============================================================================
// Central registry of available themes. To add a new theme:
//   1. Add a ThemeDefinition entry to THEMES below
//   2. Add a matching [data-theme="<id>"] block in theme.scss
//   3. That's it — the Settings UI, useTheme hook, and persistence all
//      pick up new entries automatically.
// ============================================================================

/** Describes a single UI theme. */
export interface ThemeDefinition {
  /** Unique identifier — must match the data-theme attribute value in theme.scss. */
  id: string;
  /** Display name shown in Settings. */
  label: string;
  /** Short description shown in Settings. */
  description: string;
  /** If true, this theme follows the OS preference (light/dark). */
  isSystemAuto?: boolean;
  /** The resolved data-theme value when OS is in light mode (for system-auto themes). */
  systemLightId?: string;
  /** The resolved data-theme value when OS is in dark mode (for system-auto themes). */
  systemDarkId?: string;
}

/**
 * All available themes.  Order determines display order in Settings.
 * To add a new theme, append an entry here and add a [data-theme="<id>"]
 * block in theme.scss.
 */
export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "glass",
    label: "Glassmorphism",
    description: "Dark frosted-glass aesthetic with backdrop blur effects.",
  },
  {
    id: "light",
    label: "Light",
    description: "Clean light theme with subtle depth cues.",
  },
  {
    id: "dark",
    label: "Dark",
    description: "Clean dark theme with subtle depth cues.",
  },
  {
    id: "system",
    label: "System",
    description: "Follow your OS light/dark preference (clean theme).",
    isSystemAuto: true,
    systemLightId: "light",
    systemDarkId: "dark",
  },
] as const;

/** The set of valid theme IDs derived from the registry. */
export const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));

/** The default theme ID used when nothing is persisted. */
export const DEFAULT_THEME_ID: string = "glass";

/** Look up a theme definition by ID, returning undefined if not found. */
export function getThemeById(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}
