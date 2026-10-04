import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devApiProxy } from "./devApiProxy";

const root = path.dirname(fileURLToPath(import.meta.url));
const api = devApiProxy();

export default defineConfig({
  customLogger: api.logger,
  plugins: [react()],
  optimizeDeps: {
    include: ["maplibre-gl"],
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      "/api": api.proxy,
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
