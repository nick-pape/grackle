// Minimal typing for Vite's `import.meta.env.BASE_URL`. We deliberately avoid a
// full `/// <reference types="vite/client" />` so that Vite's broad ambient
// asset-module declarations (`*.png`, `*.css`, ...) don't leak into the type
// graph of every program that compiles this file — we only need `BASE_URL`.
declare global {
  interface ImportMetaEnv {
    /** Base public path the app is served from (Vite `base`); always ends in `/`. */
    readonly BASE_URL: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

/**
 * Resolve a public asset path against the application's configured base URL.
 *
 * Public assets (logos, icons, the web manifest) sit at the site root in local
 * development but under a sub-path when the app is deployed to a base URL — e.g.
 * the GitHub Pages demo served from `/grackle/demo/`. A leading-slash `src` is
 * resolved by the browser against the origin root and ignores Vite's `base`, so
 * such assets 404 on sub-path deployments. Prefixing with
 * `import.meta.env.BASE_URL` (always set by Vite, with a trailing slash) yields
 * a path that is correct in every deployment.
 *
 * @param fileName - The asset's file name relative to the public root, ideally
 *   without a leading slash (e.g. `"icon-192x192.png"`). A leading slash is
 *   tolerated and stripped to avoid a double slash after the base.
 * @returns The base-prefixed asset URL (e.g. `"/grackle/demo/icon-192x192.png"`).
 */
export function assetUrl(fileName: string): string {
  return `${import.meta.env.BASE_URL}${fileName.replace(/^\//, "")}`;
}
