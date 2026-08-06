import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Input Component — Design System Primitive
 * Wraps <input> with consistent styling, error display, and label support.
 */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftElement, rightElement, id, ...props }, ref) => {
    // useId must be called UNCONDITIONALLY. Writing `id ?? React.useId()`
    // short-circuits and skips the hook whenever an `id` prop is supplied — so
    // the same component rendering with an id on one pass and without on the
    // next changes its hook order, which React treats as a fatal error.
    // Generate always, then prefer the caller's id.
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foreground leading-none"
          >
            {label}
            {props.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}

        <div className="relative flex items-center">
          {leftElement && (
            <div className="absolute left-3 flex items-center text-muted-foreground">
              {leftElement}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={cn(
              /* h-10 matches the new Button md size so a field and its adjacent
                 button line up on the same baseline instead of sitting 4px off. */
              "flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm",
              "shadow-xs transition-[colors,box-shadow] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
              "placeholder:text-muted-foreground",
              /* Hover previews which field is about to receive the click. */
              "hover:border-primary/40",
              /* A 4px translucent halo instead of a hard 2px ring: it marks the
                 active field unmistakably while staying soft, and keeping the
                 border opaque means the field never appears to change size. */
              "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-destructive hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
              leftElement && "pl-9",
              rightElement && "pr-9",
              className
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />

          {rightElement && (
            <div className="absolute right-3 flex items-center text-muted-foreground">
              {rightElement}
            </div>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
