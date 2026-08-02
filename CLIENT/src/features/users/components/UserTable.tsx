/**
 * The Users & Roles data table (lg and up).
 *
 * Below `lg` the page renders UserCard instead of hiding columns or scrolling
 * this horizontally — the same decision the workforce roster makes, for the
 * same reason: a seven-column table on a phone is unusable either way.
 *
 * Sorting is driven entirely by the parent's URL state. Only the four columns
 * the SERVER can sort on are made interactive; a header that reordered just the
 * current page would be a lie about what the sort did.
 */

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import type { User, UserSortBy } from "../types";
import { formatDate, formatLastLogin, fullName, initials } from "../utils/format";
import { UserRoleBadge, UserStatusBadge } from "./UserStatusBadge";
import { UserRowActions, type UserRowActionHandlers } from "./UserRowActions";

interface UserTableProps extends UserRowActionHandlers {
  rows: User[];
  isLoading?: boolean;
  sortBy: UserSortBy;
  sortOrder: "asc" | "desc";
  onSort: (key: UserSortBy) => void;
  onRowClick: (user: User) => void;
  /** The signed-in user's id — their own row is marked "You". */
  currentUserId: string | null;
}

export function UserTable({
  rows,
  isLoading,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  currentUserId,
  ...actions
}: UserTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead
            label="Name"
            sortKey="firstName"
            activeKey={sortBy}
            order={sortOrder}
            onSort={onSort}
          />
          <TableHead>Contact</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <SortableHead
            label="Joined"
            sortKey="joiningDate"
            activeKey={sortBy}
            order={sortOrder}
            onSort={onSort}
          />
          <TableHead>Last sign-in</TableHead>
          <SortableHead
            label="Created"
            sortKey="createdAt"
            activeKey={sortBy}
            order={sortOrder}
            onSort={onSort}
          />
          {/* Actions column: no header text, but it still needs an accessible name. */}
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
          : rows.map((user) => (
              <TableRow
                key={user.id}
                onClick={() => onRowClick(user)}
                className={cn(
                  "cursor-pointer",
                  // A deactivated account is still readable, just visibly
                  // dimmed — it is a real row an owner may need to act on, not
                  // a disabled control.
                  !user.isActive && "opacity-60"
                )}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                      aria-hidden="true"
                    >
                      {initials(user)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{fullName(user)}</span>
                        {user.id === currentUserId && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            You
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {user.employeeCode}
                      </span>
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="min-w-0">
                    <div className="truncate">{user.phone}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.email ?? "No email"}
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <UserRoleBadge role={user.role} />
                </TableCell>

                <TableCell>
                  <UserStatusBadge isActive={user.isActive} />
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(user.joiningDate)}
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatLastLogin(user.lastLogin)}
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(user.createdAt)}
                </TableCell>

                {/* Stop propagation so opening the menu does not also open the
                    detail drawer behind it. */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <UserRowActions user={user} {...actions} />
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}

/**
 * A header that sorts. The icon is three-state: neutral when this column is not
 * the sort, up or down when it is — so the current sort is legible without
 * reading the URL.
 */
function SortableHead({
  label,
  sortKey,
  activeKey,
  order,
  onSort,
}: {
  label: string;
  sortKey: UserSortBy;
  activeKey: UserSortBy;
  order: "asc" | "desc";
  onSort: (key: UserSortBy) => void;
}) {
  const isActive = activeKey === sortKey;
  const Icon = !isActive ? ChevronsUpDown : order === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead
      // Communicates the sort to assistive tech, which the icon alone does not.
      aria-sort={isActive ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {label}
        <Icon
          className={cn("h-3 w-3", isActive ? "text-foreground" : "text-muted-foreground/60")}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  );
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </TableCell>
      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
      <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
      <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
      <TableCell><Skeleton className="h-7 w-7 rounded-md" /></TableCell>
    </TableRow>
  );
}
