/**
 * Users & Roles — /admin/settings/users.
 *
 * The account-administration screen: who can sign in, as what, and whether
 * their access is currently live. It is the ONLY place accounts are created and
 * roles are assigned.
 *
 * HOW IT RELATES TO WORKFORCE
 * ---------------------------
 * Workforce (/admin/staff, /admin/managers) and this screen both list
 * employees, and that is deliberate rather than duplicated: they answer
 * different questions and hit different endpoints.
 *
 *   Workforce → "how is this person DOING?"  Presence, attendance, shift,
 *               today's revenue, performance score. Polls, because presence
 *               goes stale. Read-only for managers.
 *   Users     → "can this person GET IN?"    Identity, role, account status,
 *               credentials. Does not poll. OWNER-only.
 *
 * Neither is a superset. Workforce cannot create an account or assign a role;
 * this screen has no opinion on whether someone clocked in. The overlap is the
 * name and the role badge — everything else diverges, and merging them would
 * produce a screen that polls sales figures in order to change a phone number.
 *
 * RBAC: OWNER-only. `OwnerRoute` guards the route, `canAdministerUsers` gates
 * the in-page affordances, and every endpoint behind them independently 403s.
 * The guard is the boundary — the nav hiding and the disabled buttons are not.
 */

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { Button, ErrorState, Pagination } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import { ChangeRoleDialog } from "../components/ChangeRoleDialog";
import { ResetPasswordDialog } from "../components/ResetPasswordDialog";
import { ToggleStatusDialog } from "../components/ToggleStatusDialog";
import { UserCard } from "../components/UserCard";
import { UserDetailDrawer } from "../components/UserDetailDrawer";
import { UserFilters, UserSearch } from "../components/UserFilters";
import { UserFormDrawer } from "../components/UserFormDrawer";
import { UserCardSkeleton, UserEmptyState } from "../components/UserStates";
import { UserStatCards } from "../components/UserStatCards";
import { UserTable } from "../components/UserTable";
import { useUserFilters } from "../hooks/useUserFilters";
import { useUsers } from "../hooks/useUsers";
import type { User } from "../types";
import { canAdministerUsers, type Actor } from "../utils/accountRules";

export function UsersRolesPage() {
  const {
    filters,
    setFilters,
    toggleSort,
    page,
    limit,
    setPage,
    reset,
    hasActiveFilters,
    serverParams,
    isSearching,
  } = useUserFilters("users", 20);

  const currentUser = useAuthStore((s) => s.user);
  const actor: Actor = { id: currentUser?.id ?? "", role: currentUser?.role ?? null };
  const canAdminister = canAdministerUsers(actor.role);

  // One state slot per overlay. `null` closes; a user opens it for that person.
  // `creating` is separate from `editing` because create mode has no subject.
  const [viewing, setViewing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [changingRole, setChangingRole] = useState<User | null>(null);
  const [togglingStatus, setTogglingStatus] = useState<User | null>(null);
  const [resettingPassword, setResettingPassword] = useState<User | null>(null);

  const query = useUsers(serverParams);

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  /** Closes the detail drawer before opening an action, so two overlays never stack. */
  const fromDrawer = (open: (user: User) => void) => (user: User) => {
    setViewing(null);
    open(user);
  };

  const rowActions = {
    actor,
    onEdit: setEditing,
    onChangeRole: setChangingRole,
    onToggleStatus: setTogglingStatus,
    onResetPassword: setResettingPassword,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users &amp; Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who can sign in, what they can reach, and whether their access is live.
          </p>
        </div>

        {canAdminister && (
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Add user
          </Button>
        )}
      </div>

      <UserStatCards rows={rows} total={total} isLoading={query.isLoading} />

      <div className="flex flex-col gap-3">
        <UserSearch
          value={filters.search}
          onChange={(v) => setFilters({ search: v })}
          loading={isSearching || query.isFetching}
        />
        <UserFilters
          filters={filters}
          onChange={setFilters}
          onReset={reset}
          hasActiveFilters={hasActiveFilters}
        />
      </div>

      {query.isError ? (
        <ErrorState
          message="Failed to load user accounts."
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <>
          <div className="hidden lg:block">
            <UserTable
              rows={[]}
              isLoading
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={toggleSort}
              onRowClick={setViewing}
              currentUserId={actor.id}
              {...rowActions}
            />
          </div>
          <UserCardSkeleton />
        </>
      ) : rows.length === 0 ? (
        <UserEmptyState
          hasFilters={hasActiveFilters}
          onClear={reset}
          {...(canAdminister ? { onCreate: () => setCreating(true) } : {})}
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <UserTable
              rows={rows}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSort={toggleSort}
              onRowClick={setViewing}
              currentUserId={actor.id}
              {...rowActions}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {rows.map((user) => (
              <UserCard
                key={user.id}
                user={user}
                onClick={setViewing}
                currentUserId={actor.id}
                {...rowActions}
              />
            ))}
          </div>
        </>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {/* ── Overlays ───────────────────────────────────────────────────────
          Each is driven by its own state slot and independently guarded. The
          create/edit drawer is one component in two modes — `user: null` is
          create — so the form's fields and rules exist once. */}
      <UserDetailDrawer
        user={viewing}
        actor={actor}
        open={viewing !== null}
        onClose={() => setViewing(null)}
        onEdit={fromDrawer(setEditing)}
        onChangeRole={fromDrawer(setChangingRole)}
        onToggleStatus={fromDrawer(setTogglingStatus)}
        onResetPassword={fromDrawer(setResettingPassword)}
      />

      <UserFormDrawer
        open={creating || editing !== null}
        user={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ChangeRoleDialog
        user={changingRole}
        actor={actor}
        open={changingRole !== null}
        onClose={() => setChangingRole(null)}
      />

      <ToggleStatusDialog
        user={togglingStatus}
        actor={actor}
        open={togglingStatus !== null}
        onClose={() => setTogglingStatus(null)}
      />

      <ResetPasswordDialog
        user={resettingPassword}
        actor={actor}
        open={resettingPassword !== null}
        onClose={() => setResettingPassword(null)}
      />
    </div>
  );
}

export default UsersRolesPage;
