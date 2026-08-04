import { Outlet, Navigate, useLocation } from "react-router";
import { useAuthStore, selectIsAuthenticated } from "@/store/auth.store";
import { CashierSidebar } from "./CashierSidebar";
import { Navbar } from "./Navbar";
import { CashierMobileSidebar } from "./CashierMobileSidebar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

/**
 * CashierLayout — Cashier Portal Shell
 *
 * The authenticated shell for the Cashier portal. Structurally identical to
 * MainLayout (Navbar + Sidebar + scrollable Outlet) so both portals share one
 * visual system, but it wires the cashier-scoped sidebar which exposes only
 * POS Checkout and My Profile.
 *
 * Role enforcement lives in CashierRoute (the router wraps this subtree with
 * it). The isAuthenticated guard here is a defensive fallback mirroring
 * MainLayout — it never renders the shell for a signed-out user.
 */
export function CashierLayout() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <CashierSidebar />

      {/* Mobile Sidebar (slide-over) */}
      <CashierMobileSidebar />

      {/* Main Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top Navigation Bar */}
        <Navbar />

        {/* Scrollable Page Content
            Route-scoped ErrorBoundary — see MainLayout for the rationale. It
            matters most here: a cashier whose screen crashes mid-shift must
            still be able to reach the till, not just a full-page reload. */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">
            <ErrorBoundary variant="route" resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
