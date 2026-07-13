/**
 * @file features/auth/components/LoginForm.tsx
 *
 * Purpose: The login form — Employee Code + Password fields, submit logic,
 * attempt tracking, lockout UI.
 *
 * Responsibilities (strictly limited):
 *   - Renders the form fields using React Hook Form + Zod.
 *   - Calls useLogin() — does NOT interact with apiClient directly.
 *   - Tracks failed attempt count locally (not persisted — resets on refresh,
 *     which is intentional: lockout is a UX hint, not a security measure.
 *     Real brute-force protection lives in the backend rate limiter).
 *   - Shows lockout timer UI after MAX_LOGIN_ATTEMPTS failures.
 *   - Focuses Email/Phone input on mount (per UX spec: first field focused).
 *
 * What this component does NOT do:
 *   - Does not call apiClient directly.
 *   - Does not navigate (useLogin handles that).
 *   - Does not manage global auth state (useLogin handles that).
 *
 * Accessibility:
 *   - Error messages linked via aria-describedby in the Input primitive.
 *   - Form error summary announced via role="alert" aria-live region.
 *   - Loading state: button disabled + spinner, inputs remain accessible.
 *   - Keyboard: Tab order: Email/Phone → Password → Submit.
 *   - Enter on either field submits the form.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { Input, Button } from "@/components/ui";
import { PasswordField } from "./PasswordField";
import { useLogin } from "../hooks/useLogin";
import { loginSchema, type LoginFormValues } from "../validation";
import { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS } from "../constants";

export function LoginForm() {
  const { mutate: login, isPending, error, isError } = useLogin();
  const [attemptCount, setAttemptCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  // Focus Email/Phone input on mount
  useEffect(() => {
    setFocus("identifier");
  }, [setFocus]);

  // Lockout countdown timer
  useEffect(() => {
    if (!lockedUntil) return;

    const interval = setInterval(() => {
      const secondsLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
      if (secondsLeft <= 0) {
        setLockedUntil(null);
        setAttemptCount(0);
        setLockoutSecondsLeft(0);
        setFocus("identifier");
      } else {
        setLockoutSecondsLeft(secondsLeft);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lockedUntil, setFocus]);

  const onSubmit = (values: LoginFormValues) => {
    if (lockedUntil) return; // Prevent submission during lockout

    login(values, {
      onError: () => {
        const newCount = attemptCount + 1;
        setAttemptCount(newCount);
        if (newCount >= MAX_LOGIN_ATTEMPTS) {
          const lockout = new Date(Date.now() + LOCKOUT_DURATION_MS);
          setLockedUntil(lockout);
          setLockoutSecondsLeft(Math.ceil(LOCKOUT_DURATION_MS / 1000));
        }
      },
    });
  };

  const isLocked = !!lockedUntil;
  const isDisabled = isPending || isLocked;

  const minutesLeft = Math.floor(lockoutSecondsLeft / 60);
  const secondsRemaining = lockoutSecondsLeft % 60;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Sign in form"
      className="space-y-5"
    >
      {/* ── API Error Banner ──────────────────────────────────────────────── */}
      {isError && !isLocked && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
        >
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              {error?.message ?? "Sign in failed. Please try again."}
            </p>
            {attemptCount > 1 && attemptCount < MAX_LOGIN_ATTEMPTS && (
              <p className="text-xs text-destructive/80 mt-0.5">
                {MAX_LOGIN_ATTEMPTS - attemptCount} attempt
                {MAX_LOGIN_ATTEMPTS - attemptCount !== 1 ? "s" : ""} remaining
                before temporary lockout.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Lockout Banner ────────────────────────────────────────────────── */}
      {isLocked && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3"
        >
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Too many failed attempts. Please wait{" "}
            <strong>
              {minutesLeft}:{String(secondsRemaining).padStart(2, "0")}
            </strong>{" "}
            before trying again.
          </p>
        </div>
      )}

      {/* ── Identifier (Email or Phone) ────────────────────────────────────── */}
      <Input
        label="Email or Phone Number"
        placeholder="admin@example.com or 9876543210"
        autoComplete="username"
        spellCheck={false}
        disabled={isDisabled}
        error={errors.identifier?.message}
        aria-required="true"
        {...register("identifier")}
      />

      {/* ── Password ─────────────────────────────────────────────────────── */}
      <PasswordField
        label="Password"
        placeholder="Enter your password"
        autoComplete="current-password"
        disabled={isDisabled}
        error={errors.password?.message}
        aria-required="true"
        {...register("password")}
      />

      {/* ── Submit ───────────────────────────────────────────────────────── */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={isDisabled}
        loading={isPending}
        aria-busy={isPending}
      >
        {isPending ? "Signing in..." : isLocked ? `Locked (${minutesLeft}:${String(secondsRemaining).padStart(2, "0")})` : "Sign In"}
      </Button>
    </form>
  );
}
