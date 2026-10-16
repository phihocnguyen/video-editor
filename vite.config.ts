import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const onVercel = process.env.VERCEL === "1";

/** Vercel serves dist/index.html at /. The desktop app keeps the editor as index.html. */
function vercelMarketingRoot(): Plugin {
  return {
    name: "vercel-marketing-root",
    apply: "build",
    closeBundle() {
      if (!onVercel) return;
      const dist = path.resolve(__dirname, "dist");
      const marketing = path.join(dist, "marketing.html");
      const index = path.join(dist, "index.html");
      if (!fs.existsSync(marketing)) return;
      fs.renameSync(marketing, index);
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), vercelMarketingRoot()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: onVercel
        ? path.resolve(__dirname, "marketing.html")
        : {
            main: path.resolve(__dirname, "index.html"),
            marketing: path.resolve(__dirname, "marketing.html"),
          },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
