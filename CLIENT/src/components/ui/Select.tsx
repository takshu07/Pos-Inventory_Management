import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Select Component — Design System Primitive
 * Native <select> wrapped with consistent enterprise styling.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  /**
   * Set while the option list is still being fetched.
   *
   * Without this a picker whose options load asynchronously renders as a
   * one-item list ("All categories") and then visibly grows — which reads as
   * "there are no categories" rather than "still loading", and lets someone
   * open the list before it is populated. Marking it busy appends a disabled
   * "Loading…" row so the state is legible, and keeps the current value
   * selectable so a filter restored from the URL is never cleared.
   */
  loadingOptions?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, label, error, hint, options, placeholder, loadingOptions, id, ...props },
    ref
  ) => {
    // useId must be called UNCONDITIONALLY — `id ?? React.useId()` skips the
    // hook when an `id` prop is present, so a component that sometimes passes
    // one and sometimes doesn't changes its hook order between renders, which
    // React treats as a fatal error. Generate always, then prefer the caller's.
    const generatedId = React.useId();
    const selectId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-foreground leading-none">
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}

        <select
          ref={ref}
          id={selectId}
          className={cn(
            "flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm",
            "shadow-sm transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus-visible:ring-destructive",
            className
          )}
          aria-invalid={!!error}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
          {loadingOptions && (
            <option value="__loading__" disabled>
              Loading…
            </option>
          )}
        </select>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
