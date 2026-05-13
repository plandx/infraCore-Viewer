import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      // COOP is enough for most cases; COEP (require-corp) is omitted because
      // it blocks cross-origin resources like Google Fonts and causes issues in
      // Codespaces / reverse-proxy setups. Single-threaded web-ifc.wasm does
      // not need SharedArrayBuffer, so COEP is not required.
      "Cross-Origin-Opener-Policy": "same-origin",
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
