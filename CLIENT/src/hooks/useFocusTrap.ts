import * as React from "react";
import { lockBodyScroll } from "@/utils/scrollLock";

/**
 * useFocusTrap — the full overlay behaviour contract for Modal and Drawer.
 *
 * Bundles the four things every dialog owes the user, because they share one
 * lifecycle and splitting them into separate hooks guarantees one gets forgotten:
 *
 *   1. ESCAPE closes.
 *   2. BODY SCROLL LOCKS (ref-counted, scrollbar-compensated — see utils/scrollLock).
 *   3. FOCUS MOVES IN on open, so a keyboard user isn't stranded behind the
 *      overlay tabbing through content they can't see.
 *   4. FOCUS IS TRAPPED while open and RESTORED to the trigger on close. Without
 *      restore, closing a dialog dumps focus back to <body> and the next Tab
 *      starts from the top of the page — the single most disorienting thing a
 *      dialog can do to a keyboard or screen-reader user.
 *
 * In a POS this is not just accessibility: cashiers work this UI at speed with
 * one hand on a scanner and one on the keyboard. Losing focus position costs
 * real seconds per transaction.
 */

/** Elements that can hold focus, minus anything explicitly removed from the tab order. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null for display:none subtrees — a hidden control must not
    // become a dead stop in the Tab cycle.
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

export function useFocusTrap(
  open: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>
) {
  // Keep onClose in a ref so a caller passing an inline arrow (the common case)
  // doesn't tear down and rebuild the whole trap on every parent render.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const releaseScroll = lockBodyScroll();

    // Move focus inside. Prefer the first real control; fall back to the panel
    // itself (it carries tabIndex={-1}) so focus is at least inside the dialog.
    const container = containerRef.current;
    if (container) {
      const first = focusableWithin(container)[0];
      (first ?? container).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const el = containerRef.current;
      if (!el) return;

      const items = focusableWithin(el);
      if (items.length === 0) {
        // Nothing to land on — keep focus on the panel rather than letting Tab
        // escape to the page behind.
        e.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends. Also catches the case where focus somehow sits
      // outside the panel (e.g. the panel re-rendered under focus).
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      releaseScroll();
      // Only restore if the trigger is still in the document — it may have been
      // unmounted by the very action that closed this dialog.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
}
