/**
 * Page scaffolding shared by every Finance, Register and Reports screen.
 *
 * These exist so the three modules read as one product. A heading that is
 * `text-2xl` on one screen and `text-xl` on the next is the fastest way to
 * make a suite feel assembled rather than designed.
 */

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";

// =============================================================================
// PAGE HEADER
// =============================================================================

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 text-xs text-muted-foreground">{breadcrumb}</div>}
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// =============================================================================
// SECTION HEADER
// =============================================================================

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// =============================================================================
// METRIC PANEL
// =============================================================================

/**
 * A card whose body is a list of label/value rows — the P&L statement, the
 * drawer reconciliation, a shift's tender breakdown.
 *
 * Distinct from a chart card because these are STATEMENTS: the reader is
 * checking that lines add up, not spotting a trend, so alignment and a visible
 * total matter more than any visual encoding.
 */
export function MetricPanel({
  title,
  description,
  actions,
  isLoading,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  isLoading?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          {description && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
