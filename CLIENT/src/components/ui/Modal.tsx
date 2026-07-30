import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Button } from "./Button";

/**
 * Modal (Dialog) Component — Design System Primitive
 * Accessible modal with backdrop, close button, header, and footer slots.
 *
 * Behaviour (all of it delegated to useFocusTrap, shared with Drawer): Escape
 * closes, body scroll locks without a horizontal jolt, focus moves in on open,
 * is trapped while open, and returns to the trigger on close.
 *
 * ANIMATION: the modal stays mounted for EXIT_MS after `open` flips to false so
 * it can animate out. Previously this component returned null the instant
 * `open` went false, so dialogs appeared and vanished as hard cuts — the change
 * was invisible at the frame level and read as the UI "jumping" rather than
 * moving. Fading and scaling over ~150ms is short enough to feel instant while
 * still giving the eye something continuous to track.
 *
 * Users with `prefers-reduced-motion` get the same lifecycle with the transform
 * and duration neutralised in CSS (see styles/index.css) — no dropped frames,
 * no motion.
 */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
}

const sizeMap = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-lg",
  xl:   "max-w-2xl",
  full: "max-w-full mx-4",
};

/** Must match the `duration-*` classes below, or the exit frame gets cut off. */
const EXIT_MS = 150;

export function Modal({ open, onClose, title, description, children, footer, size = "md", className }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  // `mounted` = present in the DOM (outlives `open` by EXIT_MS).
  // `shown`   = the animated-in visual state.
  const [mounted, setMounted] = React.useState(open);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      // Paint one frame in the "out" state first, otherwise the browser has no
      // previous value to transition FROM and the element simply appears.
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }

    setShown(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useFocusTrap(open, onClose, panelRef);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm",
          "transition-opacity duration-150 ease-out",
          shown ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        // Focusable so the trap has a guaranteed landing spot when the dialog
        // body contains no interactive controls at all.
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full rounded-xl bg-card shadow-2xl border border-border",
          "flex flex-col max-h-[90vh] outline-none",
          "transition-[opacity,transform] duration-150 ease-out",
          // Rising slightly while scaling up reads as the dialog coming toward
          // the user, which is what a modal *is*. Pure opacity feels inert.
          shown ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.97] translate-y-1",
          sizeMap[size],
          className
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
            <div>
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-foreground leading-none">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
