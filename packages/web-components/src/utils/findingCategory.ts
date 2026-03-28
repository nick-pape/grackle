/**
 * Shared category-to-color mapping for findings.
 *
 * Centralized here so FindingsPanel, FindingsNav, and consuming pages
 * all use the same palette and stay in sync.
 *
 * @module
 */

/** Color pair for a finding category. */
export interface CategoryColor {
  /** Foreground / text color (CSS custom property). */
  text: string;
  /** Background / badge color (CSS custom property). */
  bg: string;
}

/** Category color mapping using CSS custom property values. */
export const CATEGORY_COLORS: Record<string, CategoryColor> = {
  architecture: { text: "var(--accent-blue)", bg: "var(--accent-blue-dim)" },
  api: { text: "var(--accent-green)", bg: "var(--accent-green-dim)" },
  bug: { text: "var(--accent-red)", bg: "var(--accent-red-dim)" },
  decision: { text: "var(--accent-yellow)", bg: "var(--accent-yellow-dim)" },
  dependency: { text: "var(--accent-purple)", bg: "var(--accent-purple-dim)" },
  pattern: { text: "var(--accent-cyan)", bg: "var(--accent-cyan-dim)" },
  general: { text: "var(--text-secondary)", bg: "var(--bg-elevated)" },
};

/** Look up the color pair for a category, falling back to `general`. */
export function getCategoryColor(category: string): CategoryColor {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- category may not be in the map
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.general;
}
