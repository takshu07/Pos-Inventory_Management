import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { lucideTreeShake } from "./vite/lucide-tree-shake.js";

// https://vitejs.dev/config/
export default defineConfig({
  // lucideTreeShake runs `enforce: "pre"` so it rewrites lucide-react barrel
  // imports to per-icon deep paths before other transforms — without it the
  // whole icon set (~156KB gz) ships. See vite/lucide-tree-shake.ts.
  plugins: [lucideTreeShake(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // ------------------------------------------------------------------------
    // MANUAL VENDOR CHUNKING
    // Splits heavy, rarely-changing third-party libraries into their own
    // long-cacheable chunks so that:
    //   1. recharts (~900KB) no longer rides inside the dashboard app chunk —
    //      it is fetched only when a chart-bearing view actually loads it, and
    //      is cached independently of app code.
    //   2. React / data-layer vendors get stable hashes: shipping an app change
    //      no longer busts the vendor cache, so returning users re-download far
    //      less.
    // Splitting by library keeps each chunk cohesive and cache-friendly.
    // ------------------------------------------------------------------------
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("sonner")) return "toast";
          // NOTE: lucide-react is intentionally NOT force-chunked. Assigning the
          // whole barrel module to a manual chunk defeats per-icon tree-shaking
          // and pulls in the entire icon set. Left unchunked, Rolldown keeps only
          // the icons each module actually imports.
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("/react/")
          )
            return "react-vendor";
          if (id.includes("@tanstack")) return "query-vendor";
          if (id.includes("axios")) return "axios";
          if (
            id.includes("react-hook-form") ||
            id.includes("@hookform") ||
            id.includes("/zod/")
          )
            return "forms-vendor";
          return "vendor";
        },
      },
    },
    // recharts is intentionally isolated & lazy-loaded, so the remaining chunks
    // are comfortably under this. Keeps the build honest about regressions.
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
