/**
 * Settings — loading, error and access-denied states.
 *
 * Shared by every settings screen so all three fail the same way.
 */

import { ShieldAlert } from "lucide-react";

import { ErrorState, Skeleton } from "@/components/ui";

/**
 * Skeleton shaped like the real form.
 *
 * Mirrors the section/row geometry rather than showing generic bars, so the
 * layout does not visibly reflow when content replaces it.
 */
export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((section) => (
        <div key={section} className="rounded-xl border border-border bg-card">
          <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-6">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-64" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="grid gap-2 px-4 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-6"
              >
                <div>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-48" />
                </div>
                <Skeleton className="h-9 w-full max-w-xs" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Load failure.
 *
 * A 403 is called out separately: it is not a transient failure and "Try again"
 * would be a lie — the account simply is not an owner. Every other failure gets
 * the retry.
 */
export function SettingsErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const status = (error as { status?: number } | undefined)?.status;

  if (status === 403) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-base font-semibold text-foreground">
          Owner access required
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Store settings control pricing, security and inventory rules for the
          whole business, so only an owner can view or change them.
        </p>
      </div>
    );
  }

  return (
    <ErrorState
      title="Could not load settings"
      message={
        error instanceof Error
          ? error.message
          : "Something went wrong while loading the configuration."
      }
      onRetry={onRetry}
      className="rounded-xl border border-border bg-card"
    />
  );
}
