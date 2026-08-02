/**
 * Loading and empty states for the Users & Roles list.
 *
 * The empty state distinguishes "no accounts match this filter" from "there are
 * no accounts". They need different offers: one clears the filter, the other
 * creates a user. A single generic "Nothing here" would strand someone who had
 * simply filtered to Deactivated on a store where nobody is deactivated.
 */

import { UserPlus, Users } from "lucide-react";

import { Card, EmptyState, Skeleton } from "@/components/ui";

/** Card-list skeleton for the sub-`lg` layout. The table has its own inline one. */
export function UserCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
              <div className="flex gap-1.5 pt-1">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function UserEmptyState({
  hasFilters,
  onClear,
  onCreate,
}: {
  hasFilters: boolean;
  onClear: () => void;
  onCreate?: () => void;
}) {
  if (hasFilters) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-muted-foreground" />}
        title="No accounts match these filters"
        description="Try a different search term, role or status."
        action={{ label: "Clear filters", onClick: onClear }}
      />
    );
  }

  return (
    <EmptyState
      icon={<UserPlus className="h-8 w-8 text-muted-foreground" />}
      title="No user accounts yet"
      description="Create an account so a manager or cashier can sign in."
      {...(onCreate ? { action: { label: "Add user", onClick: onCreate } } : {})}
    />
  );
}
