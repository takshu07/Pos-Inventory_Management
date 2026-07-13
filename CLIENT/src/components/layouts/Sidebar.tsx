import { NavLink } from "react-router";
import { cn } from "@/utils/cn";
import { useAuthStore } from "@/store/auth.store";
import { useUIStore } from "@/store/ui.store";
import { EMPLOYEE_NAV, ADMIN_NAV } from "@/config/navigation";
import type { NavSection, NavItem } from "@/config/navigation";
import type { Role } from "@/types";
import { ChevronLeft, Store } from "lucide-react";

/**
 * Sidebar Component — Application Shell
 * Responsibility: Persistent navigation with RBAC filtering.
 * Rules:
 *   - Renders nav items the current user's role is allowed to see.
 *   - Collapses to icon-only on desktop, slides off-canvas on mobile.
 *   - Active route is highlighted via NavLink's isActive.
 */

function canAccess(item: NavItem, role: Role): boolean {
  if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
  return item.allowedRoles.includes(role);
}

function NavSectionGroup({ section, collapsed, role }: { section: NavSection; collapsed: boolean; role: Role }) {
  const visibleItems = section.items.filter((item) => canAccess(item, role));
  if (visibleItems.length === 0) return null;

  return (
    <div className="mb-4">
      {!collapsed && (
        <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {section.title}
        </p>
      )}
      <ul className="space-y-0.5">
        {visibleItems.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground",
                  collapsed && "justify-center px-2"
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { sidebarCollapsed, toggleCollapsed } = useUIStore();
  const role = user?.role ?? "CASHIER";

  // Determine which nav sections to show based on role
  const allSections =
    role === "CASHIER" ? EMPLOYEE_NAV : [...EMPLOYEE_NAV, ...ADMIN_NAV];

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
        {sidebarCollapsed && <Store className="h-6 w-6 text-primary" />}

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
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {allSections.map((section) => (
          <NavSectionGroup
            key={section.title}
            section={section}
            collapsed={sidebarCollapsed}
            role={role}
          />
        ))}
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
