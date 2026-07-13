/**
 * @file features/auth/views/LoginView.tsx
 *
 * Purpose: The Login page. First touchpoint with the system every shift.
 *
 * Responsibilities:
 *   - Render the login form with Email/Phone and Password fields.
 *   - Manage login attempt counting and lockout UI.
 *   - Provide full keyboard-only flow (Tab → Enter → submit).
 *   - Redirect authenticated users away (prevents back-button return to login).
 *   - Show clear, actionable error messages per design-principles.md.
 *
 * Why it belongs in features/auth/views/:
 *   It is the top-level page component for the auth feature. The router
 *   imports it from the feature's public index.ts. It orchestrates the
 *   LoginForm and calls the useLogin hook — it does not contain rendering
 *   logic for individual form fields (that's in LoginForm).
 *
 * Accessibility:
 *   - Focus is set to Email/Phone field on mount automatically.
 *   - Error announcement via aria-live region.
 *   - Form has role="form" with accessible name.
 *   - No color-only error indication.
 */

import { Navigate } from "react-router";
import { useAuthStore, selectIsAuthenticated, selectSessionStatus } from "@/store/auth.store";
import { LoginForm } from "../components/LoginForm";
import { AUTH_ROUTES } from "../constants";
import { Store } from "lucide-react";
import { FullScreenLoader } from "@/components/ui";

export default function LoginView() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const sessionStatus = useAuthStore(selectSessionStatus);

  // If the user is already authenticated (e.g., valid session on browser refresh),
  // redirect them away from the login page immediately.
  // This prevents the back-button returning to login after a successful session.
  if (isAuthenticated) {
    return <Navigate to={AUTH_ROUTES.dashboard} replace />;
  }

  // While Zustand is rehydrating from localStorage on first paint, show nothing
  // (or a loader) to prevent flickering the login form briefly before redirect.
  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <FullScreenLoader />;
  }

  return (
    <div className="flex min-h-screen w-full">
      {/* ── Left Brand Panel (hidden on mobile) ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-2/5 flex-col items-center justify-center bg-primary px-12 text-primary-foreground">
        <div className="max-w-sm space-y-6">
          <div className="flex items-center gap-3">
            <Store className="h-10 w-10" />
            <span className="text-3xl font-bold tracking-tight">CEX POS</span>
          </div>
          <div>
            <h1 className="text-4xl font-bold leading-tight">
              Enterprise Garments
              <br />
              Point of Sale
            </h1>
            <p className="mt-4 text-primary-foreground/70 text-lg leading-relaxed">
              Inventory. Sales. Customers.
              <br />
              All in one place.
            </p>
          </div>
          <div className="pt-4 border-t border-primary-foreground/20">
            <p className="text-sm text-primary-foreground/60">
              Designed for speed. Built for reliability.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right Form Panel ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo (only shown on small screens) */}
          <div className="flex lg:hidden items-center gap-2">
            <Store className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">CEX POS</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Sign in to your account
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email or phone number and password to continue.
            </p>
          </div>

          <LoginForm />

          <p className="text-center text-xs text-muted-foreground">
            Having trouble signing in?{" "}
            <span className="font-medium text-foreground">
              Contact your store administrator.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
