import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Table Components — Design System Primitives
 * Composable table system for all data grid screens.
 * Usage: <Table><TableHeader>...<TableBody>...
 */

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-xl border border-border bg-card shadow-xs">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("bg-muted/60 [&_tr]:border-b [&_tr]:border-border", className)} {...props} />
  )
);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  )
);
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium", className)} {...props} />
  )
);
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        /* border-border/60 — full-strength lines between every row turn a long
           table into a grid of cages. A faint rule still guides the eye across
           without drawing attention to itself. */
        "border-b border-border/60 transition-colors duration-150",
        /* Hover is a brand-tinted wash rather than grey, and selection is marked
           in the accent colour so "what I'm pointing at" and "what is chosen"
           are never confused — the frequent misread in dense POS tables. */
        "hover:bg-accent/40",
        "data-[state=selected]:bg-accent/70",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        /* Taller header with slightly heavier weight: the column header is the
           anchor a user re-finds their place from when scanning a long table. */
        "h-11 px-4 text-left align-middle text-xs font-semibold text-muted-foreground uppercase tracking-wider",
        "[&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      /* py-3.5 over py-3. ~4px per row is invisible individually but it's the
         difference between a wall of text and a scannable list over 30 rows. */
      className={cn("px-4 py-3.5 align-middle [&:has([role=checkbox])]:pr-0 text-sm", className)}
      {...props}
    />
  )
);
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  )
);
TableCaption.displayName = "TableCaption";
