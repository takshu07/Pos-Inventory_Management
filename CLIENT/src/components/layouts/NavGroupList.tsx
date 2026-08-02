import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronRight } from "lucide-react";

import { cn } from "@/utils/cn";
import { prefetchHandlers } from "@/app/router/prefetch";
import {
  NAV_GROUPS,
  findGroupForPath,
  isGroupVisible,
  visibleGroupItems,
} from "@/config/navigation";
import type { NavGroup, NavItem } from "@/config/navigation";
import type { Role } from "@/types";

/**
 * The shared body of both sidebars.
 *
 * Desktop (Sidebar) and mobile (MobileSidebar) previously each carried their own
 * copy of the rendering logic, which is how they drifted — the mobile one never
 * got the collapsed-rail treatment and had subtly different active styles.
 * Both now render this, so the interaction model is defined once.
 *
 * ACCORDION BEHAVIOUR
 * -------------------
 * One group open at a time. With ten groups and up to eight children each,
 * free-for-all expansion just recreates the wall of links this replaces.
 * Navigating opens the owning group automatically, so the tree always shows
 * where you are — including on a cold load of a deep link.
 */

interface NavGroupListProps {
  role: Role;
  /** Icon-only rail (desktop collapsed). Groups render as icons only. */
  collapsed?: boolean;
  /** Called after navigating — the mobile drawer uses it to close itself. */
  onNavigate?: () => void;
  /**
   * Expands the icon rail back to full width. On the collapsed rail there is no
   * room to disclose children, so clicking a group opens the sidebar and then
   * opens that group, rather than doing nothing.
   */
  onExpandSidebar?: () => void;
}

export function NavGroupList({
  role,
  collapsed = false,
  onNavigate,
  onExpandSidebar,
}: NavGroupListProps) {
  const { pathname } = useLocation();

  // The group owning the current route. Recomputed on every navigation so the
  // sidebar follows the app even when the route changed from somewhere else
  // (a dashboard alert, a redirect, the back button).
  const activeGroupId = findGroupForPath(pathname, role);
  const [openId, setOpenId] = useState<string | null>(activeGroupId);

  useEffect(() => {
    if (activeGroupId) setOpenId(activeGroupId);
  }, [activeGroupId]);

  const groups = NAV_GROUPS.filter((g) => isGroupVisible(g, role));

  return (
    <ul className="space-y-0.5">
      {groups.map((group) => (
        <NavGroupRow
          key={group.id}
          group={group}
          role={role}
          collapsed={collapsed}
          isOpen={openId === group.id}
          isActiveGroup={activeGroupId === group.id}
          onToggle={() => {
            // On the rail, the click's job is to get back to a width where
            // children can actually be shown; the group is then opened.
            if (collapsed) {
              onExpandSidebar?.();
              setOpenId(group.id);
              return;
            }
            setOpenId((cur) => (cur === group.id ? null : group.id));
          }}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
    </ul>
  );
}

// =============================================================================
// GROUP ROW
// =============================================================================

interface NavGroupRowProps {
  group: NavGroup;
  role: Role;
  collapsed: boolean;
  isOpen: boolean;
  isActiveGroup: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

function NavGroupRow({
  group,
  role,
  collapsed,
  isOpen,
  isActiveGroup,
  onToggle,
  onNavigate,
}: NavGroupRowProps) {
  const items = visibleGroupItems(group, role);

  // A group that is itself a destination (Dashboard, My Account) renders as a
  // plain link — making someone expand a section to reach one page is friction
  // with nothing behind it.
  if (group.path && items.length === 0) {
    return (
      <li>
        <NavLink
          to={group.path}
          end={group.path === "/"}
          {...prefetchHandlers(group.path)}
          onClick={onNavigate}
          className={({ isActive, isPending }) =>
            rowClass(isActive, isPending && !isActive, collapsed)
          }
          title={collapsed ? group.label : undefined}
        >
          <group.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{group.label}</span>}
        </NavLink>
      </li>
    );
  }

  // ── Collapsed rail ────────────────────────────────────────────────────────
  // No room for a disclosure tree at 64px. Each group becomes its icon, and
  // clicking expands the sidebar's owner back out via the same toggle the
  // chevron uses — handled by the parent through onToggle.
  if (collapsed) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggle}
          title={group.label}
          aria-label={group.label}
          className={cn(
            "flex w-full items-center justify-center rounded-lg px-2 py-2",
            "text-sm font-medium transition-colors duration-150",
            "hover:bg-accent hover:text-accent-foreground",
            isActiveGroup
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground"
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" />
        </button>
      </li>
    );
  }

  const panelId = `nav-group-${group.id}`;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2",
          "text-sm font-medium transition-colors duration-150",
          "hover:bg-accent hover:text-accent-foreground",
          // A closed group holding the current route stays visibly marked, so
          // collapsing a section never loses your place.
          isActiveGroup && !isOpen
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground"
        )}
      >
        <group.icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{group.label}</span>
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            isOpen && "rotate-90"
          )}
          aria-hidden
        />
      </button>

      {/* Children are unmounted, not just hidden — a closed group must not be
          reachable by keyboard or read out by a screen reader. */}
      {isOpen && (
        <ul
          id={panelId}
          className={cn(
            "mt-0.5 space-y-0.5 border-l border-border pl-3 ml-4",
            "animate-in fade-in slide-in-from-top-1 duration-150"
          )}
        >
          {items.map((item) => (
            <NavItemRow
              key={`${group.id}:${item.path}`}
              item={item}
              {...(onNavigate ? { onNavigate } : {})}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// =============================================================================
// LEAF ROW
// =============================================================================

function NavItemRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === "/"}
        // Warm this screen's chunk on hover/focus/touch, so the click that
        // follows usually has nothing left to download. See app/router/prefetch.
        {...prefetchHandlers(item.path)}
        onClick={onNavigate}
        // `isPending` is true from the click until the lazy chunk resolves.
        // Highlighting the clicked item makes the app answer instantly even
        // though the screen hasn't swapped yet.
        className={({ isActive, isPending }) =>
          cn(rowClass(isActive, isPending && !isActive, false), "py-1.5")
        }
      >
        <item.icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{item.label}</span>
        {item.comingSoon && (
          <span
            className="ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70 ring-1 ring-inset ring-border"
            title="Not built yet"
          >
            Soon
          </span>
        )}
        {item.badge && (
          <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {item.badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}

/** One definition of the row look, so leaves and single-link groups match. */
function rowClass(isActive: boolean, isPending: boolean, collapsed: boolean) {
  return cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
    "transition-colors duration-150",
    "hover:bg-accent hover:text-accent-foreground",
    isActive
      ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
      : "text-muted-foreground",
    isPending && "bg-accent text-accent-foreground",
    collapsed && "justify-center px-2"
  );
}
