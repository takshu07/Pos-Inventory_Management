import { cn } from "@/utils/cn";
import { useAuthStore } from "@/store/auth.store";
import { useUIStore } from "@/store/ui.store";
import { NavGroupList } from "./NavGroupList";
import { Store, X } from "lucide-react";

/**
 * MobileSidebar — Slide-over drawer for small screens.
 * On desktop the permanent Sidebar is used instead.
 *
 * Renders the same NavGroupList as the desktop sidebar: the collapsible tree is
 * defined once, so mobile can't drift from desktop the way the two hand-rolled
 * copies did. Tapping a leaf closes the drawer.
 */

export function MobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? "CASHIER";

  return (
    <div className={cn("fixed inset-0 z-40 md:hidden", !sidebarOpen && "pointer-events-none")}>
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity",
          sidebarOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Panel */}
      <aside
        className={cn(
          "absolute left-0 top-0 h-full w-72 bg-card border-r border-border shadow-xl",
          "transition-transform duration-300 ease-in-out flex flex-col",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4 shrink-0">
          <div className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span className="font-bold text-base">CEX POS</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3" aria-label="Main navigation">
          <NavGroupList role={role} onNavigate={() => setSidebarOpen(false)} />
        </nav>

        {/* User */}
        {user && (
          <div className="flex items-center gap-3 border-t border-border p-4 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase shrink-0">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
