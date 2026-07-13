import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

interface LoadingSpinnerProps {
  className?: string;
  size?: number;
}

/**
 * Loading Spinner
 * Responsibility: Standardized loading indicator used across suspense boundaries and buttons.
 */
export function LoadingSpinner({ className, size = 24 }: LoadingSpinnerProps) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 
        className={cn("animate-spin text-primary", className)} 
        size={size} 
      />
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <LoadingSpinner size={48} />
        <p className="text-sm text-muted-foreground animate-pulse">Loading CEX POS...</p>
      </div>
    </div>
  );
}
