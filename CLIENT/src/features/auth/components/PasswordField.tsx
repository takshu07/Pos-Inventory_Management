/**
 * @file features/auth/components/PasswordField.tsx
 *
 * Purpose: Reusable password input with show/hide toggle.
 *
 * Why it exists as a separate component:
 *   The toggle-visibility behavior is needed in 3 places: login form,
 *   change-password (current), change-password (new). DRY principle.
 *   The component wraps the shared Input primitive — it adds auth-specific
 *   behavior (show/hide) without duplicating the base Input styles.
 *
 * Why NOT in src/components/ui/:
 *   The show/hide toggle with an eye icon is a security-UX pattern specific
 *   to password entry. While it could theoretically be reused outside auth,
 *   no other domain in this POS uses password fields. If it's needed elsewhere,
 *   move it to shared at that point (YAGNI).
 */

import { useState, forwardRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui";
import type { InputProps } from "@/components/ui";
import { Button } from "@/components/ui";

type PasswordFieldProps = Omit<InputProps, "type" | "rightElement">;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label, error, hint, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    const toggleButton = (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-foreground"
        onClick={() => setShowPassword((prev) => !prev)}
        aria-label={showPassword ? "Hide password" : "Show password"}
        tabIndex={-1} // Don't steal Tab focus from the input
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </Button>
    );

    return (
      <Input
        ref={ref}
        type={showPassword ? "text" : "password"}
        label={label}
        error={error}
        hint={hint}
        rightElement={toggleButton}
        autoComplete={props.autoComplete ?? "current-password"}
        {...props}
      />
    );
  }
);

PasswordField.displayName = "PasswordField";
