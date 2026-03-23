import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version as string),
  },
  build: {
    chunkSizeWarningLimit: 600,
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
