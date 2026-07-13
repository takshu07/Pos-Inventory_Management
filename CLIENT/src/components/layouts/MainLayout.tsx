import { Outlet, Navigate } from "react-router";
import { useAuthStore, selectIsAuthenticated } from "@/store/auth.store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { MobileSidebar } from "./MobileSidebar";
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

        {/* Scrollable Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
