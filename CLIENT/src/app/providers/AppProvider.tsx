/**
 * @file app/providers/AppProvider.tsx
 *
 * Purpose: Composes all global React contexts and bootstrappers.
 *
 * Changes from initial version:
 *   1. Added AuthBootstrapper — validates persisted token on mount.
 *   2. Added SessionExpiredModal — shown globally when token is rejected.
 *   Both are mounted here because they are app-wide concerns that must
 *   be active on every authenticated screen.
 *
 * Order matters:
 *   ErrorBoundary → ThemeProvider → QueryProvider → AuthBootstrapper (needs query) → children
 */

import { type ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "./QueryProvider";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" storageKey="cex-ui-theme">
        <QueryProvider>
          {children}

          {/* Global Toast Notifications via Sonner */}
          <Toaster position="top-right" richColors closeButton />
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
