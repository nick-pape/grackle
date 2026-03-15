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
  /** If set, this theme has a light variant toggled in Settings. */
  variantLightId?: string;
  /** If set, this theme has a dark variant toggled in Settings. */
  variantDarkId?: string;
  /** If true, this entry is a variant and should not be rendered as a standalone card. */
  hidden?: boolean;
}

/**
 * All available themes.  Order determines display order in Settings.
 * Themes with `hidden: true` are valid IDs but rendered as part of
 * their parent's light/dark toggle rather than as separate cards.
 */
export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "grackle",
    label: "Grackle",
    description: "The default Grackle theme — iridescent purple on clean dark.",
    swatches: ["#0e1218", "#8b5cf6", "#60a5fa", "#e5e7eb", "#34d399"],
    variantLightId: "grackle-light",
    variantDarkId: "grackle-dark",
  },
  {
    id: "grackle-light",
    label: "Grackle Light",
    description: "Light Grackle variant.",
    hidden: true,
  },
  {
    id: "grackle-dark",
    label: "Grackle Dark",
    description: "Dark Grackle variant.",
    hidden: true,
  },
  {
    id: "glass",
    label: "Glassmorphism",
    description: "Dark frosted-glass aesthetic with backdrop blur effects.",
    swatches: ["#0a0c14", "#4ecca3", "#70a1ff", "#e2e8f0", "#a855f7"],
  },
  {
    id: "matrix",
    label: "Matrix",
    description: "Phosphor-green CRT terminal with scanlines and glow.",
    swatches: ["#050505", "#00ff41", "#00bfff", "#33ff77", "#ffb000"],
  },
  {
    id: "brutalist",
    label: "Neubrutalism",
    description: "Thick borders, raw colors, bold type — ugly on purpose.",
    swatches: ["#f5f0e8", "#ff5757", "#5ce1e6", "#1a1a1a", "#ffde59"],
    variantLightId: "brutalist-light",
    variantDarkId: "brutalist-dark",
  },
  {
    id: "brutalist-light",
    label: "Neubrutalism Light",
    description: "Light neubrutalism variant.",
    hidden: true,
  },
  {
    id: "brutalist-dark",
    label: "Neubrutalism Dark",
    description: "Dark neubrutalism variant.",
    hidden: true,
  },
  {
    id: "monokai",
    label: "Monokai",
    description: "Classic warm editor palette — pink, green, and purple.",
    swatches: ["#272822", "#f92672", "#a6e22e", "#f8f8f2", "#ae81ff"],
    variantLightId: "monokai-light",
    variantDarkId: "monokai-dark",
  },
  {
    id: "monokai-dark",
    label: "Monokai Dark",
    description: "Dark Monokai variant.",
    hidden: true,
  },
  {
    id: "monokai-light",
    label: "Monokai Light",
    description: "Light Monokai variant.",
    hidden: true,
  },
  {
    id: "ubuntu",
    label: "Ubuntu",
    description: "Aubergine terminal with the GNOME Tango palette.",
    swatches: ["#300a24", "#8ae234", "#ef2929", "#eeeeec", "#fce94f"],
  },
  {
    id: "sandstone",
    label: "Sandstone",
    description: "Warm terracotta accent on dark brown, in the style of Claude Code.",
    swatches: ["#1a1815", "#C15F3C", "#6b8afd", "#e8e6e3", "#a78bfa"],
  },
  {
    id: "verdigris",
    label: "Verdigris",
    description: "Teal accent on charcoal, in the style of ChatGPT.",
    swatches: ["#141414", "#00a67e", "#3b82f6", "#ececec", "#ab68ff"],
  },
  {
    id: "primer",
    label: "Primer",
    description: "Blue accent on ink-dark grey, in the style of GitHub.",
    swatches: ["#0d1117", "#58a6ff", "#3fb950", "#c9d1d9", "#bc8cff"],
  },
] as const;

/** The set of valid theme IDs derived from the registry. */
export const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((t) => t.id));

/** The default theme ID used when nothing is persisted. */
export const DEFAULT_THEME_ID: string = "grackle";

/** Look up a theme definition by ID, returning undefined if not found. */
export function getThemeById(id: string): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}
