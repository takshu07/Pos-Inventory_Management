/**
 * Audit Logs — detail drawer.
 *
 * The evidence view for one entry: who, what, when, which record, what changed
 * field by field, and what session it came from.
 *
 * TWO THINGS THIS COMPONENT IS CAREFUL ABOUT
 * ------------------------------------------
 * 1. IT NEVER OVERSTATES WHAT IS RECORDED. `audit_logs` stores no IP or device
 *    columns; the server correlates them from the actor's login session and
 *    tags the result `source: "SESSION"`. This renders that as "From their
 *    sign-in session", never as a property of the entry, and says "Not
 *    recorded" when there is nothing to show. Presenting inferred provenance as
 *    recorded fact is the one thing an audit UI must not do.
 *
 * 2. IT DISTINGUISHES "no changes recorded" FROM "nothing changed". An entry
 *    with no snapshots (a LOGIN, say) is not a no-op update, and the empty
 *    state says which case the reader is in.
 */

import { ArrowRight, Clock, GitCompare, Monitor, Info } from "lucide-react";

import { Badge, Drawer, ErrorState, Skeleton } from "@/components/ui";
import { cn } from "@/utils/cn";
import { useAuditLog, useRelatedAuditLogs } from "../hooks/useAudit";
import type { AuditFieldChange, AuditLogEntry } from "../types";
import {
  formatFieldName,
  formatRelative,
  formatTimestamp,
  formatTimestampShort,
  formatValue,
  isComplexValue,
  severityVariant,
} from "../utils/format";

/** A labelled key/value line in the metadata grid. */
function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-words text-sm text-foreground",
          mono && "font-mono text-xs"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * One field's before/after.
 *
 * Old and new sit side by side at `sm` and stack below it. Values are rendered
 * through `formatValue`, so `null`, `""` and `false` stay visually distinct —
 * collapsing them would hide the difference between clearing a field and
 * blanking it.
 */
function ChangeRow({ change }: { change: AuditFieldChange }) {
  const complex =
    isComplexValue(change.oldValue) || isComplexValue(change.newValue);

  const ValueBlock = ({
    value,
    tone,
  }: {
    value: unknown;
    tone: "old" | "new";
  }) => (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-md border px-2 py-1.5",
        tone === "old"
          ? "border-destructive/20 bg-destructive/5"
          : "border-emerald-500/20 bg-emerald-500/5"
      )}
    >
      <p
        className={cn(
          "text-[0.7rem] font-medium uppercase tracking-wide",
          tone === "old" ? "text-destructive/80" : "text-emerald-700 dark:text-emerald-400"
        )}
      >
        {tone === "old" ? "Before" : "After"}
      </p>
      {complex ? (
        <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
          {formatValue(value)}
        </pre>
      ) : (
        <p className="mt-0.5 break-words font-mono text-xs text-foreground">
          {formatValue(value)}
        </p>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {formatFieldName(change.field)}
        </span>
        {change.changeType !== "changed" && (
          <Badge
            variant={change.changeType === "added" ? "success" : "destructive"}
            className="text-[0.65rem]"
          >
            {change.changeType === "added" ? "Added" : "Removed"}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch">
        {change.changeType !== "added" && (
          <ValueBlock value={change.oldValue} tone="old" />
        )}
        {change.changeType === "changed" && (
          <ArrowRight
            className="hidden h-4 w-4 shrink-0 self-center text-muted-foreground sm:block"
            aria-hidden="true"
          />
        )}
        {change.changeType !== "removed" && (
          <ValueBlock value={change.newValue} tone="new" />
        )}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function AuditDetailDrawer({
  entryId,
  onClose,
  onSelectRelated,
}: {
  entryId: string | undefined;
  onClose: () => void;
  onSelectRelated: (entry: AuditLogEntry) => void;
}) {
  const query = useAuditLog(entryId);
  const related = useRelatedAuditLogs(entryId);

  const entry = query.data;

  return (
    <Drawer
      open={Boolean(entryId)}
      onClose={onClose}
      title="Audit entry"
      description={entry ? `${entry.actionLabel} · ${entry.moduleLabel}` : undefined}
      width="min(38rem, 100vw)"
    >
      {query.isLoading && <DetailSkeleton />}

      {query.isError && (
        <ErrorState
          title="Could not load this entry"
          message={
            query.error instanceof Error
              ? query.error.message
              : "Something went wrong."
          }
          onRetry={() => void query.refetch()}
        />
      )}

      {entry && (
        <div className="space-y-5">
          {/* ── Headline ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(entry.severity)}>
              {entry.severity.charAt(0) + entry.severity.slice(1).toLowerCase()}
            </Badge>
            <Badge variant="outline">{entry.moduleLabel}</Badge>
            <span className="text-sm font-medium text-foreground">
              {entry.actionLabel}
            </span>
          </div>

          {/* ── Who / when / what ────────────────────────────────────────── */}
          <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
            <Field label="Performed by">
              {entry.actor.name}
              <span className="block text-xs text-muted-foreground">
                {entry.actor.role}
                {entry.actor.employeeCode ? ` · ${entry.actor.employeeCode}` : ""}
              </span>
            </Field>

            <Field label="When">
              {formatTimestamp(entry.createdAt)}
              <span className="block text-xs text-muted-foreground">
                {formatRelative(entry.createdAt)}
              </span>
            </Field>

            <Field label="Affected entity">
              {entry.entity.label}
              <span className="block text-xs text-muted-foreground">
                {entry.entity.table}
              </span>
            </Field>

            <Field label="Record ID" mono>
              {entry.entity.recordId}
            </Field>

            {entry.actor.email && <Field label="Email">{entry.actor.email}</Field>}
            <Field label="Entry ID" mono>
              {entry.id}
            </Field>
          </dl>

          {/* ── Session context — labelled as INFERRED, never as recorded ── */}
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Monitor className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Device &amp; network
            </h3>

            {entry.context ? (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                  <Field label="IP address" mono>
                    {entry.context.ipAddress ?? "Not recorded"}
                  </Field>
                  <Field label="Device">{entry.context.device ?? "Unknown"}</Field>
                  <Field label="Browser">{entry.context.browser ?? "Unknown"}</Field>
                  <Field label="Operating system">
                    {entry.context.operatingSystem ?? "Unknown"}
                  </Field>
                  {entry.context.sessionStartedAt && (
                    <Field label="Session started">
                      {formatTimestamp(entry.context.sessionStartedAt)}
                    </Field>
                  )}
                </dl>

                {/* The honesty note. This data describes the SESSION, not the
                    entry — the entry itself carries no network columns. */}
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Taken from the sign-in session this person had open at the time.
                  It is not stored on the entry itself.
                </p>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                No sign-in session covering this moment was found, so no device or
                network details are available for this entry.
              </p>
            )}
          </section>

          {/* ── The diff ─────────────────────────────────────────────────── */}
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <GitCompare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              What changed
              {entry.changes.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({entry.changes.length} field{entry.changes.length === 1 ? "" : "s"})
                </span>
              )}
            </h3>

            {entry.changes.length > 0 ? (
              <div className="space-y-2">
                {entry.changes.map((change) => (
                  <ChangeRow key={change.field} change={change} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {entry.oldData || entry.newData
                  ? "This entry recorded a snapshot, but no individual field differed."
                  : "This action does not record field-level changes."}
              </p>
            )}
          </section>

          {/* ── Other entries on the same record ─────────────────────────── */}
          {related.data && related.data.length > 0 && (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Other activity on this record
              </h3>

              <ul className="divide-y divide-border rounded-lg border border-border">
                {related.data.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRelated(item)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {item.actionLabel}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.actor.name} · {formatTimestampShort(item.createdAt)}
                        </span>
                      </span>
                      <Badge
                        variant={severityVariant(item.severity)}
                        className="shrink-0"
                      >
                        {item.severity.charAt(0) + item.severity.slice(1).toLowerCase()}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
