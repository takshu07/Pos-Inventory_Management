import { ReactNode } from "react";

interface PosLayoutProps {
  left: ReactNode;
  right: ReactNode;
}

export function PosLayout({ left, right }: PosLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] gap-4 p-4 overflow-hidden bg-muted/30">
      <div className="flex-[7] flex flex-col min-w-0 overflow-hidden rounded-xl border bg-background shadow-sm">
        {left}
      </div>
      <div className="flex-[3] flex flex-col min-w-[380px] max-w-[450px] overflow-hidden rounded-xl border bg-background shadow-sm">
        {right}
      </div>
    </div>
  );
}
