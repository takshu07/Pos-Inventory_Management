import { Outlet, Navigate, useLocation } from "react-router";
import { useAuthStore, selectIsAuthenticated } from "@/store/auth.store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { MobileSidebar } from "./MobileSidebar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useCatalogLookupPrefetch } from "@/lib/useCatalogLookupPrefetch";
/**
 * MainLayout — Authenticated Application Shell
 * Structure:
 *   +──────────────────────────────+
 *   |         Navbar (h-14)        |
 *   +───────────+──────────────────+
 *   |           |                  |
 *   | Sidebar   |   <Outlet />     |
 *   | (w-60)    |   (scrollable)   |
 *   |           |                  |
 *   +───────────+──────────────────+
 *
 * Rules:
 *   - Guards against unauthenticated access.
 *   - Never contains business logic.
 *   - The <Outlet /> is where all child routes render.
 */
export function MainLayout() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const location = useLocation();

  // Warms the category/brand/supplier dropdown caches while the shell paints,
  // so filter bars render their full option list on first paint instead of
  // visibly filling in a moment later. Called BEFORE the auth redirect below —
  // hooks must run on every render — and gated by the flag rather than by an
  // early return.
  useCatalogLookupPrefetch(isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Mobile Sidebar (slide-over) */}
      <MobileSidebar />

      {/* Main Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top Navigation Bar */}
        <Navbar />

        {/* Scrollable Page Content
            Wrapped in a route-scoped ErrorBoundary so a crash in ONE screen
            shows a contained fallback while the Navbar and Sidebar stay mounted
            and usable. Without it, the root boundary replaces the whole app —
            a broken report would leave an operator with nothing but a Refresh
            button. Keying on the pathname clears the fallback on navigation,
            so moving to a working screen recovers without a reload. */}
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
