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
    // VENDOR CHUNKING (Rolldown `advancedChunks`)
    // Splits heavy, rarely-changing third-party libraries into their own
    // long-cacheable chunks so that:
    //   1. recharts + d3 (~405KB) never ride on the critical path — they are
    //      fetched only when a chart-bearing view loads, and are cached
    //      independently of app code.
    //   2. React / data-layer vendors get stable hashes: shipping an app change
    //      no longer busts the vendor cache, so returning users re-download far
    //      less.
    //
    // WHY NOT `manualChunks`: under Vite 8 / Rolldown, the Rollup-compatible
    // `output.manualChunks` function was being CALLED but its result silently
    // ignored for modules that a matched group also reached. Verified by logging
    // it: the function returned "vendor" for clsx and "react-vendor" for react,
    // yet both ended up inside the `charts` chunk — because recharts depends on
    // clsx too, and the charts group swallowed the shared copy. Since `cn()` (and
    // therefore clsx) is imported by nearly every component, the ENTRY chunk then
    // had a static `import { … } from "./charts-*.js"`, Vite added a
    // <link rel="modulepreload"> for it, and all 405KB / 115KB gzip of
    // recharts+d3 loaded before first paint on every single page — exactly the
    // lazy-loading this config exists to guarantee, silently inverted.
    //
    // `advancedChunks` fixes it because priority is explicit and documented:
    // "Group with higher priority will be chosen first to match modules and
    // create chunks. When converting the group to a chunk, modules of that group
    // will be removed from other groups." So the small libraries that EVERYTHING
    // shares are claimed first, and `charts` can only have what is left.
    //
    // THE INVARIANT TO PRESERVE: no eagerly-loaded chunk may import `charts`.
    // Adding a group *below* charts' priority for anything the app itself uses
    // re-creates the bug. Check with:
    //   grep -l "charts-.*\.js" dist/assets/index-*.js   → must find nothing
    //   grep "modulepreload.*charts" dist/index.html      → must find nothing
    // ------------------------------------------------------------------------
    rollupOptions: {
      output: {
        advancedChunks: {
          // `[\\/]` rather than `/` — these ids carry native separators on Windows.
          groups: [
            // ── Claimed FIRST: the tiny modules shared by everything ──────────
            // These are the ones that leak. React, its helpers, and the two
            // class-name utilities behind `cn()` are reachable from both the app
            // shell and recharts, so whichever group claims them decides whether
            // the shell drags recharts along with it.
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|react-is|use-sync-external-store)[\\/]/,
              priority: 100,
            },
            {
              name: "utils-vendor",
              test: /node_modules[\\/](clsx|tailwind-merge)[\\/]/,
              priority: 95,
            },
            {
              name: "router-vendor",
              test: /node_modules[\\/]react-router/,
              priority: 90,
            },
            {
              name: "query-vendor",
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 80,
            },
            {
              name: "forms-vendor",
              test: /node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
              priority: 70,
            },
            { name: "axios", test: /node_modules[\\/]axios[\\/]/, priority: 60 },
            { name: "toast", test: /node_modules[\\/]sonner[\\/]/, priority: 50 },

            // ── recharts and its PRIVATE dependency tree ─────────────────────
            // Everything listed here is used only by recharts (the app declares
            // no redux, d3 or es-toolkit dependency of its own), so isolating it
            // keeps ~405KB off the critical path. Anything genuinely shared must
            // be given a higher-priority group above instead of being added here.
            {
              name: "charts",
              test: /node_modules[\\/](recharts|d3-[a-z-]+|internmap|victory-vendor|decimal\.js-light|es-toolkit|@reduxjs[\\/]toolkit|react-redux|redux|redux-thunk|reselect|immer)[\\/]/,
              priority: 40,
            },

            // ── Everything else ──────────────────────────────────────────────
            // NOTE: lucide-react is deliberately NOT given a group. Assigning the
            // barrel to a named chunk defeats per-icon tree-shaking and pulls in
            // the entire ~1600-icon set. Left to automatic chunking, Rolldown
            // keeps only the icons each module actually imports.
            { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
    // charts is isolated & lazy, so every remaining chunk is comfortably under
    // this. Keeps the build honest about regressions.
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
