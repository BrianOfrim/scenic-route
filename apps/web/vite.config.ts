import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["maplibre-gl"],
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5174,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
});
