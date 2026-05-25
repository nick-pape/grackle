import { test, expect } from "./fixtures.js";

/**
 * Guards the self-hosted-fonts fix (#1252).
 *
 * The web fonts (Fira Code, JetBrains Mono, DM Sans) are bundled via
 * `@fontsource-variable` and must load from `'self'` under the app's strict CSP
 * (`style-src 'self' 'unsafe-inline'`, `font-src 'self'`). Two ways this can
 * silently regress, both caught here:
 *   1. Re-introducing external `@import url('https://...')` font stylesheets
 *      (blocked by `style-src`).
 *   2. Letting Vite inline a small font subset as a `data:` URI (blocked by
 *      `font-src 'self'` — fonts must stay separate `/assets/*.woff2` files).
 */

/** Hosts the fonts used to be loaded from before self-hosting (#1252). */
const EXTERNAL_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];

test.describe("Self-hosted fonts (#1252)", { tag: ["@webui", "@smoke"] }, () => {
  test("loads all font faces from 'self' with no CSP violations", async ({ page }) => {
    const cspErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) {
        cspErrors.push(msg.text());
      }
    });
    // Network-layer guard: catches any request to an external font host even if
    // it comes from a cross-origin stylesheet whose rules we can't read.
    const externalFontRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (EXTERNAL_FONT_HOSTS.some((host) => url.includes(host))) {
        externalFontRequests.push(url);
      }
    });

    // The app holds a WebSocket + streaming RPCs open, so the network never goes
    // idle — wait on the document load event, not "networkidle".
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // Force every declared @font-face to actually load. A font blocked by CSP
    // (e.g. an inlined `data:` subset) fails, leaving its FontFace in "error".
    const erroredFonts = await page.evaluate(async () => {
      await Promise.allSettled([...document.fonts].map((face) => face.load()));
      return [...document.fonts]
        .filter((face) => face.status === "error")
        .map((face) => face.family);
    });
    // Let any CSP-violation console events from the loads flush through.
    await page.waitForTimeout(250);

    expect(erroredFonts, "no font face should fail to load under CSP").toEqual([]);
    expect(cspErrors, "app load should produce no CSP violations").toEqual([]);
    expect(externalFontRequests, "no font should be requested from an external host").toEqual([]);

    // The primary self-hosted families must be available.
    const available = await page.evaluate(() => ({
      firaCode: document.fonts.check("16px 'Fira Code Variable'"),
      dmSans: document.fonts.check("16px 'DM Sans Variable'"),
    }));
    expect(available.firaCode).toBe(true);
    expect(available.dmSans).toBe(true);
  });

  test("declares no external or data: @font-face sources", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const fontFaceSources = await page.evaluate(() => {
      const sources: string[] = [];
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // skip cross-origin sheets we can't read
        }
        for (const rule of rules) {
          if (rule instanceof CSSFontFaceRule) {
            sources.push(rule.style.getPropertyValue("src"));
          } else if (rule instanceof CSSImportRule) {
            // `@import 'https://...'` lives in our same-origin sheet, so its
            // href is readable here even when the imported sheet is cross-origin.
            sources.push(rule.href);
          }
        }
      }
      return sources;
    });

    // We should actually have self-hosted @font-face rules in the bundle.
    expect(fontFaceSources.length).toBeGreaterThan(0);
    for (const src of fontFaceSources) {
      expect(src, "fonts must not be inlined as data: URIs").not.toContain("data:");
      for (const host of EXTERNAL_FONT_HOSTS) {
        expect(src, `fonts must not be loaded from ${host}`).not.toContain(host);
      }
    }
  });
});
