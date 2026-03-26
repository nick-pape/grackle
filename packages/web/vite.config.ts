import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

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
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm", "rehype-prism-plus"],
          dagview: ["@xyflow/react", "@dagrejs/dagre"],
          grpc: ["@connectrpc/connect", "@connectrpc/connect-web", "@bufbuild/protobuf", "@grackle-ai/common"],
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
      "/grackle.Grackle": {
        target: "http://localhost:3000",
      },
    },
  },
});
