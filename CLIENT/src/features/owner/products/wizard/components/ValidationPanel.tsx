import { AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/cn";
import type { WizardIssue } from "../validation";

/**
 * ValidationPanel — surfaces blocking errors and non-blocking warnings. Shown on
 * the Review step and (compact) alongside the footer. Errors block Create;
 * warnings never do.
 */
export function ValidationPanel({
  issues,
  className,
}: {
  issues: WizardIssue[];
  className?: string;
}) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  if (issues.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/15 dark:text-emerald-400",
          className
        )}
      >
        <CheckCircle2 className="h-4 w-4" />
        Everything looks good. Ready to create.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {errors.length > 0 && (
        <Group
          tone="error"
          icon={AlertCircle}
          title={`${errors.length} issue${errors.length === 1 ? "" : "s"} must be fixed`}
          items={errors.map((e) => e.message)}
        />
      )}
      {warnings.length > 0 && (
        <Group
          tone="warning"
          icon={AlertTriangle}
          title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"} (you can still proceed)`}
          items={warnings.map((w) => w.message)}
        />
      )}
    </div>
  );
}

function Group({
  tone,
  icon: Icon,
  title,
  items,
}: {
  tone: "error" | "warning";
  icon: React.ElementType;
  title: string;
  items: string[];
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10"
          : "border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/15"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-sm font-medium",
          tone === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"
        )}
      >
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <ul className="mt-1.5 space-y-1 pl-6 text-sm text-muted-foreground list-disc">
        {items.slice(0, 12).map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
        {items.length > 12 && <li>…and {items.length - 12} more.</li>}
      </ul>
    </div>
  );
}
