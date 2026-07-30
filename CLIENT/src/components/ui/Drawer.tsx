import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Button } from "./Button";

/**
 * Drawer (Slide-Over) Component — Design System Primitive
 * Used for forms, filters, and detail panels that slide in from the side.
 *
 * NOTE ON MOUNTING: unlike Modal, this panel stays in the DOM when closed —
 * that's what lets it slide out instead of vanishing, and ~17 call sites rely
 * on the current mount lifecycle (form drawers in particular keep react-hook-form
 * state alive across open/close). It is deliberately NOT switched to conditional
 * mounting.
 *
 * The cost of staying mounted is that a closed drawer's contents remain
 * focusable — you could Tab off the visible page and land on buttons inside an
 * invisible panel, with the browser scrolling to chase focus offscreen. `inert`
 * fixes exactly that: it removes the whole subtree from the tab order and from
 * the accessibility tree while closed, without unmounting anything.
 *
 * Escape / scroll-lock / focus-in / focus-restore all come from useFocusTrap,
 * shared with Modal so the two overlays behave identically.
 */

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "left" | "right";
  width?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "right",
  width = "w-full max-w-md",
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  useFocusTrap(open, onClose, panelRef);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        side === "right" ? "justify-end" : "justify-start",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      // React 19 exposes `inert` as a first-class boolean prop.
      inert={!open}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-300",
          // Only pay for the blur while it can actually be seen. A full-viewport
          // backdrop-filter is one of the more expensive things to composite, and
          // leaving it on a permanently-mounted opacity-0 layer taxes every
          // frame of every page that merely *contains* a drawer.
          open ? "opacity-100 backdrop-blur-sm" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex flex-col h-full bg-card shadow-2xl border-l border-border outline-none",
          "transition-transform duration-300 ease-in-out",
          width,
          side === "right"
            ? (open ? "translate-x-0" : "translate-x-full")
            : (open ? "translate-x-0" : "-translate-x-full")
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
          <div>
            {title && <h2 id={titleId} className="text-lg font-semibold leading-none">{title}</h2>}
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close drawer">
            <X className="h-4 w-4" />
          </Button>
        </div>

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
