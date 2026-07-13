/**
 * @file features/auth/components/SessionExpiredModal.tsx
 *
 * Purpose: Modal shown when the backend rejects the session token (401).
 *
 * Why it exists:
 *   When a user's session expires mid-session (e.g., token lifetime exceeded
 *   or admin deactivated account), the axios interceptor sets sessionStatus
 *   to 'expired'. The app must inform the user BEFORE redirecting, so they
 *   understand why they're being sent to login (not a bug).
 *
 * Why a modal (not a redirect):
 *   An abrupt redirect without explanation violates design-principles.md
 *   Rule 7: "Every action gets feedback." The modal gives context:
 *   "Your session has expired" is more informative than suddenly appearing
 *   at the login screen with no explanation.
 *
 * Interaction with routing:
 *   This modal is shown ON TOP of whatever screen was active.
 *   The "Sign in again" button triggers logout() which navigates to /login.
 *   The modal cannot be dismissed without signing in (no backdrop close,
 *   no Escape) — expired session is a forced state.
 */

import { useAuthStore, selectSessionStatus } from "@/store/auth.store";
import { useLogout } from "../hooks/useLogout";
import { Button } from "@/components/ui";
import { ShieldAlert } from "lucide-react";

export function SessionExpiredModal() {
  const sessionStatus = useAuthStore(selectSessionStatus);
  const { logout } = useLogout();

  if (sessionStatus !== "expired") return null;

  return (
    // Full-screen overlay — not dismissible
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-desc"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card border border-border p-6 shadow-2xl space-y-4 text-center">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <ShieldAlert className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        <div>
          <h2
            id="session-expired-title"
            className="text-lg font-semibold text-foreground"
          >
            Session Expired
          </h2>
          <p
            id="session-expired-desc"
            className="mt-1 text-sm text-muted-foreground"
          >
            Your session has expired due to inactivity or a security update.
            Please sign in again to continue.
          </p>
        </div>

        <Button
          className="w-full"
          onClick={logout}
          autoFocus // Auto-focus so keyboard users can confirm immediately
        >
          Sign In Again
        </Button>
      </div>
    </div>
  );
}
