import { useState } from "react";
import { Check, Copy, Eye, Package } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CategoryRow } from "@/shared/category";

/**
 * ManagerCategoryRowActions — the manager's per-row actions.
 *
 * STRICTLY read-only / non-mutating: open details, jump to this category's
 * products, copy the name for a customer note or stock request. There is no
 * edit / archive / delete here — the owner-only action menu lives in
 * features/owner/categories and this module has no import path to it. The
 * manager backend independently rejects writes with 403.
 */
export function ManagerCategoryRowActions({
  category,
  onView,
  onViewProducts,
}: {
  category: CategoryRow;
  onView: (c: CategoryRow) => void;
  onViewProducts: (c: CategoryRow) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onView(category)}
        aria-label={`View ${category.name}`}
        title="View details"
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onViewProducts(category)}
        disabled={category.productCount === 0}
        aria-label={`View products in ${category.name}`}
        title={
          category.productCount > 0
            ? `View ${category.productCount} product${category.productCount === 1 ? "" : "s"}`
            : "No products in this category"
        }
      >
        <Package className="h-4 w-4" />
      </Button>
      <CopyButton value={category.name} label="category name" />
    </div>
  );
}

function CopyButton({ value, label }: { value: string | null; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={copy}
      disabled={!value}
      aria-label={`Copy ${label}`}
      title={value ? `Copy ${label}` : `No ${label}`}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
