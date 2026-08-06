import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Button Component — Design System Primitive
 * Variants: default, destructive, outline, ghost, link, success
 * Sizes: sm, md, lg, icon
 */

const buttonVariants = {
  variant: {
    /* Primary lifts on hover (shadow-sm → shadow-md) rather than only darkening.
       Movement toward the user reads as affordance faster than a colour shift. */
    default:     "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md",
    destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md",
    outline:     "border border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground hover:border-primary/30",
    secondary:   "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
    ghost:       "hover:bg-accent hover:text-accent-foreground",
    link:        "text-primary underline-offset-4 hover:underline",
    /* Stays emerald: on a POS, the confirm/complete-sale button is muscle memory
       and its colour is part of the meaning, not part of the theme. */
    success:     "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 hover:shadow-md",
  },
  /*
   * Heights are bumped ~1 step from the old 8/9/11. This is a touchscreen POS:
   * a 36px control is under the ~44px comfortable-tap threshold, and every near-
   * miss on a till costs a cashier real time. Larger targets also lower the
   * precision demand, which is what actually reduces body tension over a shift.
   */
  size: {
    sm:   "h-9 px-3.5 text-xs rounded-lg",
    md:   "h-10 px-4 py-2 text-sm rounded-lg",
    lg:   "h-12 px-8 text-base rounded-lg",
    icon: "h-10 w-10 rounded-lg",
  },
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonVariants.variant;
  size?: keyof typeof buttonVariants.size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
          /* Was transition-colors; box-shadow and transform are now animated too,
             so the press below actually eases instead of snapping. */
          "transition-[colors,box-shadow,transform] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          /* Tactile press. A touchscreen gives no physical travel, so this 1%
             scale substitutes the missing feedback — confirmation that the tap
             registered, which is what stops users double-tapping and
             double-charging. Kept subtle enough to feel rather than watch, and
             `transform` is GPU-composited so it never triggers layout.
             Automatically disabled by the global prefers-reduced-motion rule. */
          "active:scale-[0.99]",
          /* offset-2 with an offset colour matched to the surface gives the ring
             a clean gap instead of it fusing with the button edge. */
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          buttonVariants.variant[variant],
          buttonVariants.size[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
