import { Menu, Bell, Moon, Sun, ChevronRight, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { useUIStore } from "@/store/ui.store";
import { useAuthStore, selectRole } from "@/store/auth.store";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui";
import { useLogout, notificationsPathForRole } from "@/features/auth";
// ⚠ Imported from the HOOK module, not the feature barrel. The barrel also
// exports NotificationsPage, and the shell is in the main bundle — a barrel
// import here would statically pull the whole lazy notifications chunk into it
// (Rolldown reports this as INEFFECTIVE_DYNAMIC_IMPORT). Same reason applies in
// features/dashboard/constants.
import { useNotificationSummary } from "@/features/notifications/hooks/useNotifications";
import { cn } from "@/utils/cn";

/**
 * Top Navigation Bar — Application Shell
 * Responsibility: Global actions (notifications, theme, user menu, logout).
 * Also controls mobile sidebar toggle.
 *
 * Uses useLogout() from features/auth (not auth store directly) because
 * logout requires query cache clearing and navigation — not just store clearing.
 *
 * ⚠ The bell count is the LIVE audience-scoped unread total from
 * `/notifications/summary`, shared with the Notifications screen through the
 * same React Query key. It is deliberately not a second fetch of its own: the
 * screen's mutations already invalidate `notificationKeys.all`, so marking rows
 * read there updates this badge in the same tick. It previously rendered a
 * hardcoded red dot that claimed unread mail even when there was none.
 */

export function Navbar() {
  const { toggleSidebar, sidebarCollapsed, toggleCollapsed } = useUIStore();
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useTheme();
  const { logout } = useLogout();
  const navigate = useNavigate();
  const role = useAuthStore(selectRole);

  // Only authenticated users have notifications; the shell renders inside an
  // auth guard, but the query is still gated so a logged-out frame cannot 401.
  const { data: summary } = useNotificationSummary({ enabled: Boolean(user) });
  const unread = summary?.unreadTotal ?? 0;

  // Two-digit ceiling: a bell badge is a nudge, not a report. "99+" keeps the
  // pill from resizing the header once a store accumulates alerts.
  const unreadLabel = unread > 99 ? "99+" : String(unread);

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4 shrink-0">
      {/* Mobile Hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Desktop: Expand button (shown when sidebar is collapsed) */}
      {sidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex"
          onClick={toggleCollapsed}
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right Actions */}
      <div className="flex items-center gap-1">
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark"
            ? <Sun className="h-4 w-4" />
            : <Moon className="h-4 w-4" />
          }
        </Button>

        {/* Notifications — live unread count, navigates to the Notification Center */}
        <Button
          variant="ghost"
          size="icon"
          // ⚠ Portal-aware, not a constant "/notifications". This bar renders
          // in BOTH shells, and the manager-portal route is inside ManagerRoute
          // — a cashier sent there is bounced to /cashier/pos, so the bell
          // would show them a real count and then refuse to open.
          onClick={() => navigate(notificationsPathForRole(role))}
          // The count is in the accessible name, not just the badge glyph: a
          // screen reader user gets "3 unread notifications", not "Notifications".
          aria-label={
            unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications, none unread"
          }
          title="Notifications"
        >
          <div className="relative">
            <Bell className="h-4 w-4" />
            {/* Rendered only when there is something unread — the old static dot
                signalled unread mail unconditionally. */}
            {unread > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -right-1.5 -top-1.5 flex items-center justify-center",
                  "rounded-full bg-destructive text-destructive-foreground",
                  "text-[10px] font-semibold leading-none tabular-nums",
                  // A single digit stays a circle; wider values grow into a pill.
                  unreadLabel.length > 1 ? "h-4 min-w-4 px-1" : "h-3.5 w-3.5"
                )}
              >
                {unreadLabel}
              </span>
            )}
          </div>
        </Button>

        {/* User Avatar */}
        {user && (
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full bg-primary",
            "text-primary-foreground text-xs font-bold uppercase cursor-pointer",
            "hover:ring-2 hover:ring-primary/30 transition-all"
          )}>
            {user.firstName[0]}{user.lastName[0]}
          </div>
        )}

        {/* Logout */}
        {user && (
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
