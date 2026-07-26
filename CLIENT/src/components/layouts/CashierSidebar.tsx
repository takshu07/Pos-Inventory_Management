import { NavLink } from "react-router";
import { cn } from "@/utils/cn";
import { useAuthStore } from "@/store/auth.store";
import { useUIStore } from "@/store/ui.store";
import { CASHIER_NAV } from "@/config/cashierNavigation";
import type { NavSection } from "@/config/navigation";
import { ChevronLeft, Store } from "lucide-react";

/**
 * CashierSidebar — Cashier Portal Shell
 *
 * Responsibility: Persistent navigation for the Cashier portal.
 * Rules:
 *   - Renders the fixed CASHIER_NAV (POS Checkout + My Profile only).
 *   - No RBAC filtering is needed here: the whole /cashier subtree is already
 *     restricted to the CASHIER role by CashierRoute, so any user who reaches
 *     this component is, by construction, a cashier.
 *   - Mirrors the manager Sidebar's visual language (collapse, active state,
 *     user footer) so the two portals feel like one product.
 */

function NavSectionGroup({ section, collapsed }: { section: NavSection; collapsed: boolean }) {
  return (
    <div className="mb-4">
      {!collapsed && (
        <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {section.title}
        </p>
      )}
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
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

export function CashierSidebar() {
  const user = useAuthStore((s) => s.user);
  const { sidebarCollapsed, toggleCollapsed } = useUIStore();

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
          <div className="flex items-center gap-2 min-w-0">
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
        {CASHIER_NAV.map((section) => (
          <NavSectionGroup key={section.title} section={section} collapsed={sidebarCollapsed} />
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
