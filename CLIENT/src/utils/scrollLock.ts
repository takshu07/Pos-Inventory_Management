/**
 * @file utils/scrollLock.ts
 *
 * Ref-counted body scroll lock for overlays (Modal, Drawer).
 *
 * WHY REF-COUNTED: the naive `document.body.style.overflow = "hidden"` on open /
 * `= ""` on close breaks the moment two overlays coexist — and they do here
 * (a Drawer that opens a confirm Modal, a Modal containing a nested detail
 * Drawer). Whichever closes FIRST clears the lock, and the page starts
 * scrolling behind the overlay that's still open. Counting locks means the page
 * unlocks only when the last overlay closes.
 *
 * WHY IT PADS THE BODY: hiding the overflow removes the scrollbar, which widens
 * the viewport by ~15px and shoves the whole page sideways at the exact moment
 * the overlay appears. That horizontal jolt is one of the most noticeable pieces
 * of jank in a web app. Replacing the scrollbar's width with padding keeps the
 * layout pinned. Overlay-style scrollbars (macOS, most touch devices) report a
 * width of 0, so the padding is a no-op there.
 */

let lockCount = 0;
/** The inline styles we overwrote, captured once at the first lock. */
let restore: { overflow: string; paddingRight: string } | null = null;

/** Take a lock. Returns the matching release function — call it exactly once. */
export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    const { style } = document.body;
    restore = { overflow: style.overflow, paddingRight: style.paddingRight };

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      // Add to whatever padding the body already had rather than replacing it.
      const existing = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      style.paddingRight = `${existing + scrollbarWidth}px`;
    }
  }

  lockCount += 1;

  let released = false;
  return () => {
    // Guard against double-release (React 19 StrictMode runs effect cleanups
    // twice in dev); a second decrement would unlock while overlays are open.
    if (released) return;
    released = true;

    lockCount -= 1;
    if (lockCount === 0 && restore) {
      document.body.style.overflow = restore.overflow;
      document.body.style.paddingRight = restore.paddingRight;
      restore = null;
    }
  };
}
