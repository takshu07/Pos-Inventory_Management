import { NavLink } from "react-router";
import { cn } from "@/utils/cn";
import { prefetchHandlers } from "@/app/router/prefetch";
import { useAuthStore } from "@/store/auth.store";
import { useUIStore } from "@/store/ui.store";
import { CASHIER_NAV, isExactCashierNavPath } from "@/config/cashierNavigation";
import { Store, X } from "lucide-react";

/**
 * CashierMobileSidebar — Slide-over drawer for the Cashier portal on small
 * screens. Desktop uses the permanent CashierSidebar instead. Renders the fixed
 * CASHIER_NAV; no RBAC filtering (the /cashier subtree is already CASHIER-only).
 */
export function CashierMobileSidebar() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const user = useAuthStore((s) => s.user);

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
        <nav className="flex-1 overflow-y-auto p-3">
          {CASHIER_NAV.map((section) => (
            <div key={section.title} className="mb-4">
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {section.title}
              </p>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={isExactCashierNavPath(item.path)}
                  onClick={() => setSidebarOpen(false)}
                  {...prefetchHandlers(item.path)}
                  className={({ isActive, isPending }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium mb-0.5",
                      "transition-all duration-150",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      isPending && !isActive && "bg-accent text-accent-foreground"
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
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
