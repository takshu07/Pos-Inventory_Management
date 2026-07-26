import type { ReactNode } from "react";

/** StepShell — consistent heading + body layout for every wizard step. */
export function StepShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** A titled group of fields. */
export function FieldGroup({
  title,
  children,
  columns = 2,
}: {
  title?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const cols =
    columns === 1
      ? "grid-cols-1"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";
  return (
    <div className="flex flex-col gap-3">
      {title && (
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
      )}
      <div className={`grid gap-4 ${cols}`}>{children}</div>
    </div>
  );
}
