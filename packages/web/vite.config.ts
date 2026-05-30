import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

/** Font file extensions that must never be inlined as `data:` URIs (see below). */
const FONT_FILE_PATTERN = /\.(?:woff2?|ttf|otf|eot)$/i;

export default defineConfig({
  base: process.env.VITE_BASE_URL || "/",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version as string),
    __DEMO_MODE__: JSON.stringify(process.env.VITE_DEMO_MODE === "true"),
    __BASE_URL__: JSON.stringify(process.env.VITE_BASE_URL || "/"),
  },
  build: {
    chunkSizeWarningLimit: 800,
    // Emit external source maps (separate `*.js.map` files). These let the
    // Playwright E2E coverage pass map V8 coverage of the minified bundle back
    // to `packages/web/src/**` source (#1383). External maps (not `inline`)
    // are NOT counted toward `chunkSizeWarningLimit`, so they don't trip the
    // warnings-as-errors CI gate; inline maps would. The repo is public OSS, so
    // shipping maps leaks nothing. `@grackle-ai/web-server` serves any dist
    // file, so the `.map` files are reachable when the app is served.
    sourcemap: true,
    // Never inline font files as base64 `data:` URIs. Vite inlines assets under
    // ~4 KB by default, which would emit small self-hosted font subsets (e.g.
    // JetBrains Mono's tiny cyrillic-ext subset) as `data:font/woff2;base64,...`.
    // The app's strict CSP sets `font-src 'self'`, which blocks `data:` fonts —
    // so fonts must always be emitted as separate `/assets/*.woff2` files served
    // from 'self' (#1252). Returning `undefined` for non-fonts keeps Vite's
    // default size-based inlining for every other asset type.
    assetsInlineLimit: (filePath: string): boolean | undefined =>
      FONT_FILE_PATTERN.test(filePath) ? false : undefined,
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm", "rehype-prism-plus"],
          dagview: ["@xyflow/react", "@dagrejs/dagre"],
          grpc: [
            "@connectrpc/connect",
            "@connectrpc/connect-web",
            "@bufbuild/protobuf",
            "@grackle-ai/common",
          ],
        },
      },
    },
  },
  // Dev-server proxy: when running `vite dev` (port 5173), forward WebSocket
  // and ConnectRPC requests to the Grackle server on port 3000. This is only
  // active in local development; the production build is served by the Grackle
  // server itself (same origin, port 3000) so no proxy is needed there.
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/grackle.GrackleCore": {
        target: "http://localhost:3000",
      },
      "/grackle.GrackleOrchestration": {
        target: "http://localhost:3000",
      },
      "/grackle.GrackleScheduling": {
        target: "http://localhost:3000",
      },
      "/grackle.GrackleKnowledge": {
        target: "http://localhost:3000",
      },
    },
  },
});
