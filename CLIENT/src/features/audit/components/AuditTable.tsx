/**
 * Audit Logs — desktop table and mobile cards.
 *
 * Two renderings of the same rows, swapped at `lg`. The table is dense on
 * purpose: scanning an audit trail means comparing many rows at once, so the
 * row height stays tight and severity is carried by a left accent so it reads
 * without focusing on any single cell.
 *
 * Every row is activatable (click, Enter, Space) and exposed as a button to
 * assistive tech — the detail is where the actual evidence lives, so reaching
 * it must not require a mouse.
 */

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
} from "@/components/ui";
import { cn } from "@/utils/cn";
import type { AuditLogEntry } from "../types";
import {
  formatRelative,
  formatTimestampShort,
  severityAccent,
  severityVariant,
  shortId,
} from "../utils/format";

function ActorCell({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-foreground">
        {entry.actor.name}
      </p>
      <p className="truncate text-xs text-muted-foreground">{entry.actor.role}</p>
    </div>
  );
}

export function AuditTable({
  rows,
  onSelect,
  selectedId,
}: {
  rows: AuditLogEntry[];
  onSelect: (entry: AuditLogEntry) => void;
  selectedId?: string | undefined;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[9rem]">When</TableHead>
            <TableHead className="w-[7rem]">Severity</TableHead>
            <TableHead className="w-[12rem]">Action</TableHead>
            <TableHead className="w-[10rem]">Module</TableHead>
            <TableHead>Affected record</TableHead>
            <TableHead className="w-[12rem]">By</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((entry) => (
            <TableRow
              key={entry.id}
              role="button"
              tabIndex={0}
              aria-label={`${entry.actionLabel} on ${entry.entity.label} by ${entry.actor.name}. View details.`}
              onClick={() => onSelect(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(entry);
                }
              }}
              className={cn(
                "cursor-pointer transition-colors hover:bg-muted/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                severityAccent(entry.severity),
                selectedId === entry.id && "bg-muted"
              )}
            >
              <TableCell className="whitespace-nowrap">
                <span className="text-sm text-foreground">
                  {formatTimestampShort(entry.createdAt)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatRelative(entry.createdAt)}
                </span>
              </TableCell>

              <TableCell>
                <Badge variant={severityVariant(entry.severity)}>
                  {entry.severity.charAt(0) + entry.severity.slice(1).toLowerCase()}
                </Badge>
              </TableCell>

              <TableCell>
                <span className="text-sm font-medium text-foreground">
                  {entry.actionLabel}
                </span>
              </TableCell>

              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {entry.moduleLabel}
                </span>
              </TableCell>

              <TableCell className="min-w-0">
                <span className="text-sm text-foreground">{entry.entity.label}</span>
                {/* The id is shown by its TAIL — cuids share a prefix, so the
                    last characters are what actually distinguish them. */}
                <span
                  className="block font-mono text-xs text-muted-foreground"
                  title={entry.entity.recordId}
                >
                  {shortId(entry.entity.recordId)}
                </span>
              </TableCell>

              <TableCell>
                <ActorCell entry={entry} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Sub-`lg` rendering. Same data, stacked, with the same activation contract. */
export function AuditCardList({
  rows,
  onSelect,
}: {
  rows: AuditLogEntry[];
  onSelect: (entry: AuditLogEntry) => void;
}) {
  return (
    <div className="grid gap-2 lg:hidden">
      {rows.map((entry) => (
        <Card
          key={entry.id}
          role="button"
          tabIndex={0}
          aria-label={`${entry.actionLabel} on ${entry.entity.label} by ${entry.actor.name}. View details.`}
          onClick={() => onSelect(entry)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(entry);
            }
          }}
          className={cn(
            "cursor-pointer p-3 transition-colors hover:bg-muted/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            severityAccent(entry.severity)
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {entry.actionLabel}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {entry.moduleLabel} · {entry.entity.label}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {entry.actor.name} · {formatTimestampShort(entry.createdAt)}
              </p>
            </div>

            <Badge variant={severityVariant(entry.severity)} className="shrink-0">
              {entry.severity.charAt(0) + entry.severity.slice(1).toLowerCase()}
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}
