/**
 * NotificationsPage — /notifications.
 *
 * RBAC: available to EVERY authenticated employee, deliberately. Notifications
 * are addressed to a person or a role, and the server AND-s an audience
 * predicate into every query — so a cashier sees their own and nobody else's.
 * A role guard here would hide alerts from the people they were written for.
 *
 * The Preferences tab is the exception: it edits `integrationConfig`, which is
 * OWNER-only server-side, so it is not offered to non-owners rather than
 * rendering a panel that would 403.
 *
 * Filter state lives in the URL so a filtered view is linkable and survives a
 * refresh — the same decision the Label Engine tabs made.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { CheckCheck, Loader2 } from "lucide-react";

import { Button, ErrorState, Pagination } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";

import { NotificationFilters } from "../components/NotificationFilters";
import {
  NotificationEmptyState,
  NotificationList,
  NotificationListSkeleton,
} from "../components/NotificationList";
import { NotificationPreferences } from "../components/NotificationPreferences";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useNotificationSummary,
  useNotifications,
} from "../hooks/useNotifications";
import type {
  NotificationCategory,
  NotificationListParams,
  NotificationSeverity,
} from "../types";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SEVERITIES } from "../types";
import { selectionLabel, unreadBadgeLabel } from "../utils/format";

type Tab = "inbox" | "preferences";

const PAGE_SIZE = 25;

/** Reads a comma list from the URL, keeping only values the server accepts. */
function parseCsv<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is T => (allowed as readonly string[]).includes(v));
}

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const role = useAuthStore((s) => s.user?.role ?? null);
  const isOwner = role === "OWNER";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tabParam = params.get("tab");
  // A non-owner cannot reach preferences even by typing the URL.
  const tab: Tab = tabParam === "preferences" && isOwner ? "preferences" : "inbox";

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const search = params.get("search") ?? "";
  const categories = parseCsv<NotificationCategory>(
    params.get("category"),
    NOTIFICATION_CATEGORIES
  );
  const severities = parseCsv<NotificationSeverity>(
    params.get("severity"),
    NOTIFICATION_SEVERITIES
  );
  const readParam = params.get("read");
  const readState: "all" | "unread" | "read" =
    readParam === "unread" || readParam === "read" ? readParam : "all";

  const hasActiveFilters =
    search !== "" ||
    categories.length > 0 ||
    severities.length > 0 ||
    readState !== "all";

  /** Writes filter state to the URL, always resetting to page 1 on a change. */
  const update = (next: Record<string, string | null>, keepPage = false) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    if (!keepPage) merged.delete("page");
    setParams(merged, { replace: true });
    // A filter change makes the old selection meaningless — rows may no longer
    // even be on screen, and a hidden selection is how bulk actions surprise
    // people.
    setSelectedIds(new Set());
  };

  const queryParams: NotificationListParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(search && { search }),
      ...(categories.length > 0 && { category: categories }),
      ...(severities.length > 0 && { severity: severities }),
      ...(readState !== "all" && { isRead: readState === "read" }),
    }),
    [page, search, categories.join(","), severities.join(","), readState]
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useNotifications(queryParams);
  const { data: summary } = useNotificationSummary();
  const markRead = useMarkNotificationsRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data?.data ?? [];
  const meta = data?.meta;
  const unreadTotal = meta?.unreadTotal ?? summary?.unreadTotal ?? 0;

  const selectableUnread = items.filter((i) => !i.isRead);
  const allUnreadSelected =
    selectableUnread.length > 0 &&
    selectableUnread.every((i) => selectedIds.has(i.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(
      allUnreadSelected ? new Set() : new Set(selectableUnread.map((i) => i.id))
    );
  };

  const handleMarkRead = (ids: string[]) => {
    if (ids.length === 0) return;
    markRead.mutate(ids, {
      onSuccess: () =>
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        }),
    });
  };

  const resetFilters = () =>
    update({ search: null, category: null, severity: null, read: null });

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            Notifications
            {unreadTotal > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
                {unreadBadgeLabel(unreadTotal)}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alerts about inventory, sales, employees and security.
          </p>
        </div>

        {tab === "inbox" && unreadTotal > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {markAll.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            <span className="ml-1.5">Mark all read</span>
          </Button>
        )}
      </div>

      {/* ── Tabs (Preferences is owner-only) ────────────────────────────── */}
      {isOwner && (
        <div className="flex gap-1 border-b border-border" role="tablist">
          {([
            ["inbox", "Inbox"],
            ["preferences", "Preferences"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => update({ tab: id === "inbox" ? null : id })}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "preferences" ? (
        <NotificationPreferences />
      ) : (
        <>
          <NotificationFilters
            search={search}
            onSearchChange={(v) => update({ search: v || null })}
            categories={categories}
            onToggleCategory={(c) =>
              update({
                category:
                  (categories.includes(c)
                    ? categories.filter((x) => x !== c)
                    : [...categories, c]
                  ).join(",") || null,
              })
            }
            severities={severities}
            onToggleSeverity={(s) =>
              update({
                severity:
                  (severities.includes(s)
                    ? severities.filter((x) => x !== s)
                    : [...severities, s]
                  ).join(",") || null,
              })
            }
            readState={readState}
            onReadStateChange={(v) => update({ read: v === "all" ? null : v })}
            summary={summary}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
          />

          {/* ── Bulk action bar ─────────────────────────────────────────── */}
          {selectableUnread.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allUnreadSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                />
                Select all unread on this page
              </label>

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectionLabel(selectedIds.size)}
                </span>
                <Button
                  size="sm"
                  disabled={selectedIds.size === 0 || markRead.isPending}
                  onClick={() => handleMarkRead([...selectedIds])}
                >
                  {markRead.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Mark read
                </Button>
              </div>
            </div>
          )}

          {/* ── Content ─────────────────────────────────────────────────── */}
          {isLoading ? (
            <NotificationListSkeleton />
          ) : isError ? (
            <ErrorState
              title="Could not load notifications"
              message={
                error instanceof Error
                  ? error.message
                  : "Something went wrong while loading your notifications."
              }
              onRetry={() => void refetch()}
            />
          ) : items.length === 0 ? (
            <NotificationEmptyState
              filtered={hasActiveFilters}
              onReset={resetFilters}
            />
          ) : (
            <div className={cn(isFetching && "opacity-60 transition-opacity")}>
              <NotificationList
                items={items}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onMarkRead={handleMarkRead}
                isMarking={markRead.isPending}
              />
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <Pagination
              currentPage={meta.page}
              totalPages={meta.totalPages}
              onPageChange={(p) => update({ page: String(p) }, true)}
            />
          )}

          {meta && meta.total > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {meta.total} notification{meta.total === 1 ? "" : "s"}
              {hasActiveFilters && " matching these filters"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
