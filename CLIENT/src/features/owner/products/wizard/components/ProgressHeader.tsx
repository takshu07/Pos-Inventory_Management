import { Check } from "lucide-react";
import { cn } from "@/utils/cn";
import { WIZARD_STEPS } from "../types";

/**
 * ProgressHeader — step indicator + progress bar. Completed steps show a check
 * and are clickable (jump back); the active step is highlighted; future steps
 * are dimmed. A thin animated bar under the row reflects overall progress.
 */
export function ProgressHeader({
  activeIndex,
  furthestIndex,
  onStepClick,
}: {
  activeIndex: number;
  furthestIndex: number;
  onStepClick: (index: number) => void;
}) {
  const pct = (activeIndex / (WIZARD_STEPS.length - 1)) * 100;

  return (
    <div className="border-b border-border bg-card/60 px-4 py-3 sm:px-6">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {WIZARD_STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const reachable = i <= furthestIndex;
          return (
            <div key={step.key} className="flex items-center shrink-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && onStepClick(i)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-2.5 py-1 text-sm transition-colors",
                  active && "bg-primary/10 text-primary font-medium",
                  !active && reachable && "text-foreground hover:bg-accent",
                  !reachable && "text-muted-foreground/50 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs shrink-0",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && "border-primary text-primary",
                    !done && !active && "border-border text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="hidden whitespace-nowrap sm:inline">{step.label}</span>
              </button>
              {i < WIZARD_STEPS.length - 1 && (
                <div className="mx-0.5 h-px w-4 bg-border sm:w-6" />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
