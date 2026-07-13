/**
 * @file features/auth/views/UnauthorizedView.tsx
 *
 * Purpose: Shown when an authenticated user attempts to access a route
 * their role does not permit.
 *
 * Why it exists:
 *   A Cashier navigating directly to /admin/employees must not see a blank
 *   page, a cryptic error, or the raw underlying data. They must see a clear,
 *   friendly message explaining what happened and how to proceed.
 *
 * Security note:
 *   This view does NOT reveal what is on the restricted page. It only says
 *   "you don't have permission." It does not expose route names, admin features,
 *   or any information about the restricted content.
 */

import { useNavigate } from "react-router";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui";
import { AUTH_ROUTES } from "../constants";

export default function UnauthorizedView() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
        <ShieldOff className="h-10 w-10 text-destructive" />
      </div>

      <div className="space-y-2 max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Access Denied</h1>
        <p className="text-muted-foreground text-sm">
          You don't have permission to view this page. Contact your store
          administrator if you believe this is an error.
        </p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
        <Button onClick={() => navigate(AUTH_ROUTES.dashboard, { replace: true })}>
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
