import { Menu, Bell, Moon, Sun, ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui.store";
import { useAuthStore } from "@/store/auth.store";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui";
import { useLogout } from "@/features/auth";
import { cn } from "@/utils/cn";

/**
 * Top Navigation Bar — Application Shell
 * Responsibility: Global actions (notifications, theme, user menu, logout).
 * Also controls mobile sidebar toggle.
 *
 * Uses useLogout() from features/auth (not auth store directly) because
 * logout requires query cache clearing and navigation — not just store clearing.
 */

export function Navbar() {
  const { toggleSidebar, sidebarCollapsed, toggleCollapsed } = useUIStore();
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useTheme();
  useLogout(); // Keep wired — logout will be called from user menu in future

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

        {/* Notifications */}
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <div className="relative">
            <Bell className="h-4 w-4" />
            {/* Unread indicator */}
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
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
      </div>
    </header>
  );
}
