/**
 * The summary strip above the users table.
 *
 * HONESTY ABOUT WHAT IS COUNTED
 * -----------------------------
 * There is no `/employees/stats` endpoint, so only ONE number here is a true
 * total: `total`, which comes from the list response's `meta.total` and counts
 * every account matching the current filters across all pages.
 *
 * The role and status breakdowns are computed from the LOADED PAGE. Labelling
 * them "Managers: 3" would be a lie the moment there are two pages — so they
 * are labelled "on this page" and sit visually subordinate to the real total.
 * The alternative (fetching every account to count them) would download the
 * whole employee table to render four numbers.
 *
 * TODO(stats): when the additive `GET /employees/stats` endpoint described in
 * SERVER/src/services/employee.service.ts (above `listEmployees`) lands, replace
 * the four derived counts below with a `useUserStats(serverParams)` call, delete
 * the `rows`-based arithmetic, and drop the "on this page" qualifier from every
 * card. Do NOT fix this by fetching all accounts and counting client-side — that
 * downloads the whole employee table to render four numbers and breaks past the
 * server's `limit: 100` cap.
 */

import { Card, Skeleton } from "@/components/ui";
import type { User } from "../types";

export function UserStatCards({
  rows,
  total,
  isLoading,
}: {
  rows: User[];
  total: number;
  isLoading?: boolean;
}) {
  const active = rows.filter((u) => u.isActive).length;
  const deactivated = rows.length - active;
  const managers = rows.filter((u) => u.role === "MANAGER").length;
  const cashiers = rows.filter((u) => u.role === "CASHIER").length;

  const cards = [
    { label: "Accounts", value: total, scope: "matching filters" },
    { label: "Active", value: active, scope: "on this page" },
    { label: "Deactivated", value: deactivated, scope: "on this page" },
    { label: "Managers", value: managers, scope: "on this page" },
    { label: "Cashiers", value: cashiers, scope: "on this page" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} className="p-4">
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          {isLoading ? (
            <Skeleton className="mt-1.5 h-7 w-12" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">{card.scope}</p>
        </Card>
      ))}
    </div>
  );
}
