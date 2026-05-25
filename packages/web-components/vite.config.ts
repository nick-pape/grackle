import { defineConfig, build, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { resolve } from "node:path";

/**
 * Second, self-contained build for the MCP Apps React runtime (#1268). Unlike the
 * main library build (which externalizes React + `@grackle-ai/*` so the web SPA
 * provides them), the runtime is a standalone bundle served from the sandbox
 * origin: it bundles React, the curated Grackle component set, react-live, and the
 * ext-apps guest bridge into one `mcp-app-runtime/runtime.js`, with CSS injected
 * via JS (the sandbox loads a single script). Run from the main build's
 * `closeBundle`; `configFile: false` keeps the nested build from re-loading this
 * config (no recursion).
 */
function buildRuntimeBundle(): Plugin {
  return {
    name: "grackle-build-mcp-runtime",
    closeBundle: {
      sequential: true,
      async handler(): Promise<void> {
        await build({
          configFile: false,
          root: __dirname,
          define: { "process.env.NODE_ENV": JSON.stringify("production") },
          plugins: [react(), cssInjectedByJsPlugin()],
          build: {
            outDir: resolve(__dirname, "mcp-app-runtime"),
            emptyOutDir: true,
            minify: true,
            lib: {
              entry: resolve(__dirname, "src/mcp-runtime/index.tsx"),
              formats: ["es"],
              fileName: () => "runtime.js",
            },
            // No `external`: bundle React + the component library into one file.
            // `inlineDynamicImports` forces a SINGLE self-contained file — the
            // sandbox server only serves `/runtime.js`, never split chunks.
            rollupOptions: {
              output: { inlineDynamicImports: true },
            },
          },
        });
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), buildRuntimeBundle()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "react", "react-dom", "react-router", "react/jsx-runtime",
        /^@grackle-ai\//,
      ],
    },
  },
});
