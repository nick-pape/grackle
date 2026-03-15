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
  /** Preview colors shown as swatches in Settings (bg, accent, text). */
  swatches?: string[];
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
    swatches: ["#0a0c14", "#4ecca3", "#70a1ff", "#e2e8f0", "#a855f7"],
  },
  {
    id: "light",
    label: "Light",
    description: "Clean light theme with subtle depth cues.",
    swatches: ["#ffffff", "#10b981", "#3b82f6", "#1c2129", "#8b5cf6"],
  },
  {
    id: "dark",
    label: "Dark",
    description: "Clean dark theme with subtle depth cues.",
    swatches: ["#0e1218", "#34d399", "#60a5fa", "#e5e7eb", "#a78bfa"],
  },
  {
    id: "matrix",
    label: "Matrix",
    description: "Green-on-black CRT terminal with scanlines and glow.",
    swatches: ["#000000", "#00ff41", "#00bfff", "#008f11", "#ffb000"],
  },
  {
    id: "brutalist",
    label: "Neubrutalism",
    description: "Thick borders, raw colors, bold type — ugly on purpose.",
    swatches: ["#f5f0e8", "#ff5757", "#5ce1e6", "#1a1a1a", "#ffde59"],
  },
  {
    id: "monokai",
    label: "Monokai",
    description: "Classic Monokai color scheme — warm and familiar.",
    swatches: ["#272822", "#f92672", "#a6e22e", "#f8f8f2", "#ae81ff"],
  },
  {
    id: "ubuntu",
    label: "Ubuntu",
    description: "Aubergine terminal inspired by Ubuntu's default palette.",
    swatches: ["#300a24", "#4e9a06", "#cc0000", "#eeeeec", "#c4a000"],
  },
  {
    id: "claude",
    label: "Claude Code",
    description: "Warm dark theme inspired by Claude's visual identity.",
    swatches: ["#1a1815", "#C15F3C", "#6b8afd", "#e8e6e3", "#a78bfa"],
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
