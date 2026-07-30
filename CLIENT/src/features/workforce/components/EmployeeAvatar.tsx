/**
 * Employee avatar with an initials fallback and an optional presence ring.
 *
 * The fallback matters more than the photo: most retail staff records have no
 * uploaded picture, so initials are the common case, not the error case. The
 * colour is derived deterministically from the employee id so the same person
 * always gets the same tile — which makes rows scannable without reading names.
 */

import { useState } from "react";
import { cn } from "@/utils/cn";
import { initials } from "../utils/format";
import type { PresenceStatus } from "../types";

const TILE_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
];

/** Stable hash → colour index. Same id always yields the same tile. */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length]!;
}

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

export function EmployeeAvatar({
  id,
  firstName,
  lastName,
  photoUrl,
  presence,
  size = "md",
  className,
}: {
  id: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string | null;
  presence?: PresenceStatus | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // A broken photo URL must degrade to initials, not to a broken-image icon.
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed;

  return (
    <div className={cn("relative shrink-0", className)}>
      {showPhoto ? (
        <img
          src={photoUrl as string}
          alt={`${firstName ?? ""} ${lastName ?? ""}`.trim() || "Employee"}
          onError={() => setFailed(true)}
          className={cn("rounded-full object-cover", SIZES[size])}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full font-semibold",
            SIZES[size],
            colorFor(id)
          )}
          aria-hidden="true"
        >
          {initials(firstName, lastName)}
        </div>
      )}

      {presence && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-card",
            size === "sm" ? "h-2 w-2" : size === "md" ? "h-2.5 w-2.5" : "h-3.5 w-3.5",
            presence === "ONLINE" ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
          aria-label={presence === "ONLINE" ? "Online" : "Offline"}
        />
      )}
    </div>
  );
}
