/**
 * Login History — the security dashboard.
 *
 * Failed attempts are shown alongside successful ones by default. A login
 * history that only lists successes is a worse security tool than none,
 * because it implies nothing else was tried.
 *
 * Three bands: live session counters, grouped failed attempts (the forensic
 * view), then the full session table. Owner-only actions — terminate one
 * session, force a full logout — sit on the rows they act on. Both are real
 * revocations: the server invalidates the cached auth context so the token
 * stops working on the very next request, not whenever it happens to expire.
 */

import { useState } from "react";
import {
  Activity, LogIn, LogOut, ShieldAlert, ShieldX, Users, XCircle,
} from "lucide-react";

import {
  Badge, Button, Card, EmptyState, ErrorState, Pagination, Select,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui";
import { canManageEmployees } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/utils/cn";
import { EmployeeSearch } from "../components/EmployeeFilters";
import { ExportMenu } from "../components/ExportMenu";
import { LoginHistoryTable } from "../components/LoginHistoryTable";
import { StatCard, StatCardSkeleton } from "../components/WorkforceStatCards";
import {
  useForceLogout,
  useLoginHistory,
  useSecurityOverview,
  useTerminateSession,
} from "../hooks/useWorkforce";
import { formatDateTime, formatDuration, formatRelative } from "../utils/format";
import type { WorkforcePeriod } from "../types";

const PAGE_SIZE = 25;

const OUTCOME_OPTIONS = [
  { value: "", label: "All attempts" },
  { value: "true", label: "Successful only" },
  { value: "false", label: "Failed only" },
];

const SESSION_OPTIONS = [
  { value: "", label: "All sessions" },
  { value: "true", label: "Active sessions only" },
];

const PERIOD_OPTIONS: Array<{ value: WorkforcePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export default function LoginHistoryPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const canManage = canManageEmployees(role);

  const [isSuccessful, setIsSuccessful] = useState("");
  const [activeOnly, setActiveOnly] = useState("");
  const [period, setPeriod] = useState<WorkforcePeriod>("today");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const overview = useSecurityOverview({ period, limit: 20 });

  const { data, isLoading, isError, refetch, isFetching } = useLoginHistory({
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(isSuccessful ? { isSuccessful: isSuccessful === "true" } : {}),
    ...(activeOnly ? { activeOnly: true } : {}),
  });

  const terminate = useTerminateSession();
  const forceLogout = useForceLogout();

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const stats = overview.data;
  const failures = stats?.failedAttempts ?? [];

  const resetPage = () => setPage(1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Login History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sessions, sign-in attempts and devices — the security view of who accessed the
            system, from where.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            className="w-auto min-w-[9rem]"
            options={PERIOD_OPTIONS}
            value={period}
            onChange={(e) => setPeriod(e.target.value as WorkforcePeriod)}
            aria-label="Counter period"
          />
          <ExportMenu
            report="login-history"
            filters={{
              ...(debouncedSearch ? { search: debouncedSearch } : {}),
              ...(isSuccessful ? { isSuccessful } : {}),
              ...(activeOnly ? { activeOnly: true } : {}),
            }}
          />
        </div>
      </div>

      {/* ── Band 1: live counters ─────────────────────────────────────────── */}
      {overview.isLoading || !stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            icon={LogIn}
            label="Active sessions"
            value={String(stats.activeSessions)}
            accent={stats.activeSessions > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined}
          />
          <StatCard
            icon={ShieldX}
            label="Failed logins"
            value={String(stats.failedLogins)}
            accent={stats.failedLogins > 0 ? "text-destructive" : undefined}
          />
          <StatCard
            icon={Activity}
            label="Avg session"
            value={formatDuration(stats.averageSessionMinutes)}
          />
          <StatCard icon={Users} label="Logged in" value={String(stats.loggedInToday)} />
          <StatCard
            icon={LogIn}
            label="Concurrent"
            value={String(stats.concurrentSessions)}
          />
        </div>
      )}

      {/* ── Band 2: failed attempts, grouped ──────────────────────────────── */}
      {failures.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
              Failed Sign-in Attempts
            </h2>
            <p className="text-xs text-muted-foreground">
              Grouped by employee and source address — repeated failures from one IP are the
              pattern worth investigating.
            </p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[12rem]">Employee</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Last Attempt</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((f) => (
                  <TableRow
                    key={`${f.employeeId}-${f.ipAddress ?? "unknown"}`}
                    className={cn(f.isSuspicious && "bg-destructive/[0.04]")}
                  >
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm">{f.fullName ?? "Unknown"}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {f.employeeCode ?? "—"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {f.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.reason ?? "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        f.isSuspicious && "text-destructive"
                      )}
                    >
                      {f.attempts}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatRelative(f.lastAttemptAt)}
                    </TableCell>
                    <TableCell>
                      {/* Flagged server-side at 5+, the lockout-policy threshold. */}
                      {f.isSuspicious ? (
                        <Badge variant="error">Suspicious</Badge>
                      ) : (
                        <Badge variant="secondary">Isolated</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ── Band 3: the session table ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <EmployeeSearch
          value={search}
          onChange={(v) => {
            setSearch(v);
            resetPage();
          }}
          loading={search !== debouncedSearch || isFetching}
          placeholder="Search by employee name or ID…"
        />

        <div className="flex flex-wrap items-end gap-2">
          <Select
            className="w-auto min-w-[10rem]"
            options={OUTCOME_OPTIONS}
            value={isSuccessful}
            onChange={(e) => {
              setIsSuccessful(e.target.value);
              resetPage();
            }}
            aria-label="Filter by outcome"
          />
          <Select
            className="w-auto min-w-[11rem]"
            options={SESSION_OPTIONS}
            value={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.value);
              resetPage();
            }}
            aria-label="Filter by session state"
          />
        </div>
      </div>

      {isError ? (
        <ErrorState message="Failed to load login history." onRetry={() => refetch()} />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="h-8 w-8 text-muted-foreground" />}
          title="No sign-ins found"
          description="Nothing matches these filters. Try clearing the outcome or session filter."
        />
      ) : (
        <div className="overflow-x-auto">
          <LoginHistoryTable
            rows={rows}
            isLoading={isLoading}
            showEmployee
            // Owner-only. A manager sees the same table without the column —
            // and the endpoints 403 for them regardless.
            {...(canManage
              ? {
                  renderActions: (row) => (
                    <div className="flex items-center justify-end gap-1">
                      {row.sessionStatus === "ACTIVE" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={terminate.isPending}
                          onClick={() => terminate.mutate(row.id)}
                          leftIcon={<XCircle className="h-3.5 w-3.5" />}
                        >
                          End
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={forceLogout.isPending}
                        onClick={() => forceLogout.mutate(row.employeeId)}
                        leftIcon={<LogOut className="h-3.5 w-3.5" />}
                      >
                        Log out all
                      </Button>
                    </div>
                  ),
                }
              : {})}
          />
        </div>
      )}

      {total > 0 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      {(terminate.isSuccess || forceLogout.isSuccess) && (
        <p className="text-xs text-muted-foreground">
          Session ended at {formatDateTime(new Date().toISOString())}. The employee must sign
          in again.
        </p>
      )}
    </div>
  );
}
