/**
 * Status badges for the workforce module.
 *
 * Every badge reads its colour from the mappings in utils/format, so a status
 * can never be rendered with an ad-hoc colour that contradicts another screen.
 */

import { Badge } from "@/components/ui";
import { cn } from "@/utils/cn";
import type {
  AttendanceStatus,
  EmploymentStatus,
  PresenceStatus,
  SessionStatus,
} from "../types";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_VARIANTS,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_VARIANTS,
  SESSION_LABELS,
  SESSION_VARIANTS,
} from "../utils/format";

/**
 * Presence indicator.
 *
 * Rendered as a coloured dot rather than a full badge: presence appears on
 * every row of a dense table, and a dot carries the same information at a
 * fraction of the visual weight. The label is kept for screen readers.
 */
export function PresenceDot({
  presence,
  withLabel = false,
  className,
}: {
  presence: PresenceStatus;
  withLabel?: boolean;
  className?: string;
}) {
  const online = presence === "ONLINE";

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative flex h-2 w-2" aria-hidden="true">
        {online && (
          // The ping ring is what makes "online" read as live rather than as
          // just another green dot.
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            online ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </span>
      {withLabel ? (
        <span className={cn("text-xs", online ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {online ? "Online" : "Offline"}
        </span>
      ) : (
        <span className="sr-only">{online ? "Online" : "Offline"}</span>
      )}
    </span>
  );
}

export function AttendanceBadge({
  status,
  className,
}: {
  status: AttendanceStatus | null | undefined;
  className?: string;
}) {
  // A null status means no attendance row exists for the day yet — which is
  // meaningfully different from "absent" and must not be shown as such.
  if (!status) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        Not marked
      </Badge>
    );
  }

  return (
    <Badge variant={ATTENDANCE_VARIANTS[status]} className={className}>
      {ATTENDANCE_LABELS[status]}
    </Badge>
  );
}

export function EmploymentBadge({
  status,
  className,
}: {
  status: EmploymentStatus;
  className?: string;
}) {
  return (
    <Badge variant={EMPLOYMENT_VARIANTS[status]} className={className}>
      {EMPLOYMENT_LABELS[status]}
    </Badge>
  );
}

export function SessionBadge({
  status,
  className,
}: {
  status: SessionStatus;
  className?: string;
}) {
  return (
    <Badge variant={SESSION_VARIANTS[status]} className={className}>
      {SESSION_LABELS[status]}
    </Badge>
  );
}

/** Role chip. Owner is visually distinct because it is the privileged role. */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const variant =
    role === "OWNER" ? "default" : role === "MANAGER" ? "info" : "secondary";
  const label = role.charAt(0) + role.slice(1).toLowerCase();

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
