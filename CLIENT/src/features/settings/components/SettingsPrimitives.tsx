/**
 * Settings — reusable layout and field primitives.
 *
 * The shared vocabulary for every settings screen. Receipt & Invoice Settings
 * and Barcode Settings are expected to build entirely from these, so that all
 * three screens stay visually and behaviourally identical without any of them
 * re-deciding what a settings row looks like.
 *
 * LAYOUT RULE — one column on phones, label-beside-control from `md` up.
 * Settings are read as a list of "what is this / what is it set to" pairs, which
 * is a two-column relationship. Below `md` there is no room for that without
 * squeezing both halves, so the pair stacks. Every primitive here follows the
 * same breakpoint, so rows line up across sections.
 *
 * These are presentational. None of them fetch, save, or know about React Query
 * — state comes from `useSettingsForm` and is passed down.
 */

import * as React from "react";
import { cn } from "@/utils/cn";

// =============================================================================
// SECTION
// =============================================================================

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Rendered top-right — a section-level badge or action. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * One titled group of related settings.
 *
 * `id` is applied to the section element so the in-page section nav can jump to
 * it and so a validation error can scroll its section into view.
 */
export function SettingsSection({
  id,
  title,
  description,
  icon,
  aside,
  children,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      // Offsets the sticky page header when jumped to via anchor, so the
      // heading is not hidden underneath it.
      className="scroll-mt-24 rounded-xl border border-border bg-card"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          {icon && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-base font-semibold leading-none text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {aside}
      </header>

      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

// =============================================================================
// ROW
// =============================================================================

interface SettingsRowProps {
  label: string;
  /** The "why should I care" line. Worth writing for anything non-obvious. */
  description?: string;
  htmlFor?: string;
  /** Marks the value as edited-but-unsaved. */
  dirty?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * One label + control pair.
 *
 * The control column is capped rather than fluid: a number input stretched
 * across a widescreen monitor reads as a text field and invites the wrong kind
 * of input. `sm:max-w-xs` keeps controls at a size that suggests their content.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  dirty,
  error,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "grid gap-2 px-4 py-4 sm:px-6",
        "md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start md:gap-6",
        className
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          {label}
          {dirty && (
            // A quiet marker, not a badge: it should be findable when scanning
            // for "what did I change" without competing with the value itself.
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              title="Unsaved change"
              aria-label="Unsaved change"
            />
          )}
        </label>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      <div className="min-w-0">
        {children}
        {error && (
          <p className="mt-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// TOGGLE
// =============================================================================

interface SettingsToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Describes what the switch controls, for screen readers. */
  label: string;
  id?: string;
}

/**
 * Accessible switch.
 *
 * A real `<button role="switch">` rather than a styled checkbox: it announces
 * its state correctly, is reachable by keyboard with no extra wiring, and cannot
 * be submitted as form data by accident.
 */
export function SettingsToggle({
  checked,
  onChange,
  disabled,
  label,
  id,
}: SettingsToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

// =============================================================================
// STICKY SAVE BAR
// =============================================================================

interface SettingsSaveBarProps {
  visible: boolean;
  saving: boolean;
  changeCount: number;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * The save affordance for a long form.
 *
 * Sticky at the bottom because these pages are taller than a viewport: a Save
 * button at the end of the document is invisible from wherever the user actually
 * made a change, and a top-anchored one scrolls away. It appears only when there
 * is something to save, so it never occupies space while reading.
 *
 * The change count is shown because the form is long enough that the user may
 * not remember everything they touched before committing it.
 */
export function SettingsSaveBar({
  visible,
  saving,
  changeCount,
  onSave,
  onDiscard,
}: SettingsSaveBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 mt-2 sm:-mx-6",
        "transition-[opacity,transform] duration-200 ease-out",
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0"
      )}
      // Hidden from assistive tech when inert, so a keyboard user does not tab
      // into a bar that is visually absent.
      aria-hidden={!visible}
    >
      <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:mx-6">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium",
              "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={cn(
              "inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground",
              "shadow-sm transition-colors hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
