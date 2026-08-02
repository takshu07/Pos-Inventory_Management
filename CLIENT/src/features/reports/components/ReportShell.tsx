/**
 * The frame every individual report page sits in.
 *
 * WHY A SHELL RATHER THAN TWELVE HAND-BUILT PAGES
 * -----------------------------------------------
 * Each report needs the identical scaffolding: a header, the shared filter bar
 * wired to the shared filter-options query, an export menu pointed at its own
 * endpoint, the active-filter chips, and an error state. Repeating that eleven
 * more times guarantees they drift — one report ends up without chips, another
 * exports without its filters, and nobody notices until an export disagrees
 * with the screen.
 *
 * The shell owns all of it. A report page is then just: pick a hook, describe
 * the charts and the table.
 */

import { Card, CardContent } from "@/components/ui";
import {
  ActiveFilterChips,
  ExportMenu,
  FilterBar,
  PageHeader,
  cleanFilters,
  type FilterKey,
  type ReportFilterState,
} from "@/components/shared/bi";
import { AlertCircle } from "lucide-react";

import { useFilterOptions } from "../hooks/useReports";
import type { ReportKey } from "../api/reportsApi";

export interface ReportShellProps {
  title: string;
  description?: string;
  /** Drives the export endpoint: /reports/export/<reportKey>. */
  reportKey: ReportKey;
  filters: ReportFilterState;
  onFiltersChange: (next: ReportFilterState) => void;
  /** Which of the shared dimension filters this report exposes. */
  show?: FilterKey[];
  /** Extra controls rendered inside the filter bar (granularity, bucket, …). */
  filterExtras?: React.ReactNode;
  /** Extra query params that belong in the export URL but not the filter bar. */
  exportExtras?: Record<string, unknown>;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  children: React.ReactNode;
}

export function ReportShell({
  title,
  description,
  reportKey,
  filters,
  onFiltersChange,
  show = [],
  filterExtras,
  exportExtras = {},
  isLoading,
  isError,
  error,
  children,
}: ReportShellProps) {
  const options = useFilterOptions();
  const exportParams = { ...cleanFilters(filters), ...exportExtras };

  return (
    <div className="space-y-5">
      <PageHeader title={title} {...(description ? { description } : {})} />

      <FilterBar
        value={filters}
        onChange={onFiltersChange}
        options={options.data}
        show={show}
        isLoading={isLoading}
        actions={
          <>
            {filterExtras}
            <ExportMenu path={`/reports/export/${reportKey}`} filters={exportParams} />
          </>
        }
      />

      <ActiveFilterChips
        filters={filters}
        options={options.data}
        onChange={onFiltersChange}
      />

      {isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2.5 py-6">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium">This report could not be loaded.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(error as { response?: { data?: { message?: string } }; message?: string })
                  ?.response?.data?.message ??
                  (error as { message?: string })?.message ??
                  "The server rejected the request. Check the filters and try again."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        children
      )}
    </div>
  );
}
