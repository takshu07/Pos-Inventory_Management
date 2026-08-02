import { cn } from "@/utils/cn";
import { useAuthStore } from "@/store/auth.store";
import { useUIStore } from "@/store/ui.store";
import { NavGroupList } from "./NavGroupList";
import { ChevronLeft, Store } from "lucide-react";

/**
 * Sidebar Component — Application Shell
 * Responsibility: Persistent navigation with RBAC filtering.
 * Rules:
 *   - Renders nav items the current user's role is allowed to see.
 *   - Collapses to icon-only on desktop, slides off-canvas on mobile.
 *   - Active route is highlighted via NavLink's isActive.
 *
 * The tree itself lives in NavGroupList, shared with MobileSidebar so the two
 * cannot drift. This file owns only the chrome: brand, rail width, user footer.
 */

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { sidebarCollapsed, toggleCollapsed } = useUIStore();
  const role = user?.role ?? "CASHIER";

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col h-full border-r border-border bg-card",
        "transition-all duration-300 ease-in-out shrink-0",
        sidebarCollapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo / Brand */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-border px-3 shrink-0",
          sidebarCollapsed ? "justify-center" : "justify-between"
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary shrink-0" />
            <span className="font-bold text-base tracking-tight truncate">CEX POS</span>
          </div>
        )}
        {/* Collapsed: the logo itself expands the rail. Without this the only
            way back out was the group buttons, which is not discoverable. */}
        {sidebarCollapsed && (
          <button
            onClick={toggleCollapsed}
            className="rounded-md p-1 text-primary transition-colors hover:bg-accent"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <Store className="h-6 w-6" />
          </button>
        )}

        {!sidebarCollapsed && (
          <button
            onClick={toggleCollapsed}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Main navigation">
        <NavGroupList
          role={role}
          collapsed={sidebarCollapsed}
          onExpandSidebar={() => sidebarCollapsed && toggleCollapsed()}
        />
      </nav>

      {/* User Footer */}
      {user && (
        <div
          className={cn(
            "flex items-center gap-3 border-t border-border p-3 shrink-0",
            sidebarCollapsed && "justify-center"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase">
            {user.firstName[0]}{user.lastName[0]}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.role}</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
