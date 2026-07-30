/**
 * PrinterStatus — online/offline indicator for a printer.
 *
 * Reads the persisted status recorded by the last probe or print attempt rather
 * than polling the device on render. Probing on every render would put a socket
 * connection behind every table row repaint.
 */

import { AlertCircle, CircleHelp, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui";
import { cn } from "@/utils/cn";

import type { PrinterStatus as PrinterStatusValue } from "../api/labelApi";

export interface PrinterStatusProps {
  status: PrinterStatusValue;
  lastSeenAt?: string | null;
  lastErrorText?: string | null;
  showLabel?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  PrinterStatusValue,
  {
    label: string;
    variant: "success" | "destructive" | "secondary" | "warning";
    Icon: typeof Wifi;
  }
> = {
  ONLINE: { label: "Online", variant: "success", Icon: Wifi },
  OFFLINE: { label: "Offline", variant: "destructive", Icon: WifiOff },
  ERROR: { label: "Error", variant: "destructive", Icon: AlertCircle },
  UNKNOWN: { label: "Not checked", variant: "secondary", Icon: CircleHelp },
};

export function PrinterStatus({
  status,
  lastSeenAt,
  lastErrorText,
  showLabel = true,
  className,
}: PrinterStatusProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNKNOWN;
  const { Icon } = config;

  // The tooltip carries the diagnostic detail so the badge itself stays compact
  // in a dense table.
  const title =
    status === "ONLINE" && lastSeenAt
      ? `Last seen ${new Date(lastSeenAt).toLocaleString()}`
      : lastErrorText || config.label;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={title}>
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {showLabel && config.label}
      </Badge>
    </span>
  );
}
