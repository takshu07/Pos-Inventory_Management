// =============================================================================
// ROUTE ERROR ELEMENT — chunk-failure detection
//
// The recovery action depends on getting this classification right, which is
// why it is worth a test rather than being inlined:
//
//   • stale chunk  → RELOAD. The chunk filename no longer exists on the server
//                    (a deploy replaced it), so re-running the same import
//                    fetches the same missing file and fails identically.
//   • app error    → TRY AGAIN. Re-running the route is a real recovery.
//
// Offering "Try again" for a stale chunk produces a button that cannot ever
// work — the user clicks it repeatedly on a screen that will never load.
//
// The strings below are REAL messages from the browsers this POS runs on. They
// disagree with each other, which is exactly why the match is a set of patterns
// rather than one canonical string.
// =============================================================================

import { describe, expect, it } from "vitest";

import { isChunkLoadError } from "../RouteErrorElement";

describe("isChunkLoadError", () => {
  describe("recognises a failed dynamic import", () => {
    it("Vite / Chrome", () => {
      expect(
        isChunkLoadError(
          new Error("Failed to fetch dynamically imported module: https://pos/assets/CycleCountsPage-a1b2c3.js")
        )
      ).toBe(true);
    });

    it("Firefox", () => {
      expect(
        isChunkLoadError(new Error("error loading dynamically imported module"))
      ).toBe(true);
    });

    it("Safari", () => {
      expect(
        isChunkLoadError(new Error("Importing a module script failed."))
      ).toBe(true);
    });

    it("webpack-style ChunkLoadError, matched on the error NAME", () => {
      // The name carries the signal here, not the message — so the check must
      // read both. This is the case a message-only match would miss.
      const err = new Error("Loading chunk 42 failed.");
      err.name = "ChunkLoadError";
      expect(isChunkLoadError(err)).toBe(true);
    });
  });

  describe("does not misclassify ordinary failures", () => {
    it("an application error", () => {
      expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    });

    it("an API error", () => {
      // Would otherwise get a "Reload" button that fixes nothing.
      expect(isChunkLoadError(new Error("Request failed with status code 500"))).toBe(false);
    });

    it("a non-Error value thrown by a loader", () => {
      expect(isChunkLoadError("some string")).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
      expect(isChunkLoadError({ message: "Failed to fetch dynamically imported module" })).toBe(
        false
      );
    });
  });
});
