/**
 * Guards the self-hosted-fonts fix (#1252).
 *
 * The web fonts (Fira Code, JetBrains Mono, DM Sans) must be served from
 * `'self'` via the bundled `@fontsource-variable` packages — never re-introduced
 * as external `@import url('https://...')` stylesheets, which the app's strict
 * Content-Security-Policy (`style-src 'self'`, `font-src 'self'`) blocks. These
 * cheap source-level assertions catch a silent regression without needing a
 * browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Reads a sibling stylesheet in this directory as UTF-8 text. */
function readStyle(fileName: string): string {
  return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), "utf-8");
}

describe("self-hosted fonts (#1252)", () => {
  const globalScss: string = readStyle("./global.scss");
  const themeScss: string = readStyle("./theme.scss");

  it("does not import any external font stylesheets in global.scss", () => {
    // No external `@import` — these violate `style-src 'self'`. Matches both the
    // `@import url('https://...')` form and the bare `@import 'https://...'` /
    // `@import "https://..."` forms SCSS also allows.
    expect(globalScss).not.toMatch(/@import\s+(?:url\(\s*)?['"]?https?:/i);
  });

  it("imports all three font families from @fontsource-variable", () => {
    for (const pkg of [
      "@fontsource-variable/fira-code",
      "@fontsource-variable/jetbrains-mono",
      "@fontsource-variable/dm-sans",
    ]) {
      expect(globalScss).toContain(pkg);
    }
  });

  it("wires the variable family names into the font-family stacks", () => {
    // @fontsource-variable registers families suffixed with " Variable"; the
    // CSS vars must list those names first or the fonts load but never apply.
    expect(themeScss).toContain("'DM Sans Variable'");
    expect(themeScss).toContain("'Fira Code Variable'");
    expect(themeScss).toContain("'JetBrains Mono Variable'");
  });
});
