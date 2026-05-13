import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["web-ifc"],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (multi-threaded WASM)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/web-ifc")) return "web-ifc";
        },
      },
    },
  },
  assetsInclude: ["**/*.wasm"],
});
