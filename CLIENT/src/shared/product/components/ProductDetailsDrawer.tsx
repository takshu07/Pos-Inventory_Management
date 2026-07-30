import { useState } from "react";
import { Lock, Copy, Check } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LabelToolbar } from "@/features/labels";
import { cn } from "@/utils/cn";
import type { ProductDetail } from "../types";
import { ProductImageGallery } from "./ProductImageGallery";
import { ProductVariantTable } from "./ProductVariantTable";
import { ProductPriceCard } from "./ProductPriceCard";
import { ProductStatusBadge } from "./ProductStatusBadge";
import { ProductStockIndicator } from "./ProductStockIndicator";

/**
 * ProductDetailsDrawer — read-only product detail panel, shared by both modules.
 *
 * The Manager module passes `readOnlyBanner` to surface the "read-only" notice
 * and `showFinancials={false}` so cost/margin never render. The Owner module can
 * inject edit affordances via `headerActions` and pass `showFinancials`. The
 * drawer itself never mutates anything — it is a viewer.
 */

type Tab = "overview" | "variants" | "pricing";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export function ProductDetailsDrawer({
  open,
  onClose,
  product,
  loading = false,
  showFinancials = false,
  readOnlyBanner = false,
  headerActions,
  renderPricingDetail,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductDetail | null | undefined;
  loading?: boolean;
  showFinancials?: boolean;
  readOnlyBanner?: boolean;
  headerActions?: React.ReactNode;
  /**
   * Optional per-variant effective-price breakdown, rendered under the price
   * aggregates. Passed in as a slot so this shared component stays decoupled
   * from the discounts feature — it never imports it, and a module that doesn't
   * want the breakdown simply omits the prop.
   */
  renderPricingDetail?: (productId: string) => React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={product?.name ?? (loading ? "Loading…" : "Product")}
      description={product ? product.category?.name ?? undefined : undefined}
      width="w-full max-w-2xl"
    >
      {loading || !product ? (
        <div className="text-sm text-muted-foreground">Loading product details…</div>
      ) : (
        <div className="flex flex-col gap-4">
          {readOnlyBanner && <ReadOnlyBanner />}

          <div className="flex flex-wrap items-center gap-2">
            {headerActions}
            {/* Product-level label printing: every active variant at once.
                Lives in the shared drawer so both the Owner and Manager modules
                get identical behaviour without either importing print logic.
                The toolbar enforces its own RBAC — a cashier viewing a
                multi-variant product sees no batch action. */}
            {product.variants.length > 0 && (
              <LabelToolbar
                source="PRODUCT"
                hidePreview={product.variants.length > 1}
                variants={product.variants
                  .filter((variant) => variant.isActive)
                  .map((variant) => ({
                    variantId: variant.id,
                    label: [
                      product.name,
                      [variant.size?.name, variant.color?.name]
                        .filter(Boolean)
                        .join(" / "),
                    ]
                      .filter(Boolean)
                      .join(" — "),
                    sku: variant.sku,
                  }))}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <ProductStatusBadge isActive={product.isActive} />
            <ProductStockIndicator
              status={product.rollup.stockStatus}
              totalStock={product.rollup.totalStock}
            />
            {product.brand?.name && <Badge variant="outline">{product.brand.name}</Badge>}
          </div>

          <TabBar tab={tab} onChange={setTab} />

          {tab === "overview" && <Overview product={product} />}
          {tab === "variants" && (
            // Label actions are enabled here for every role: the toolbar applies
            // its own RBAC (cashiers print one at a time, managers may batch),
            // so a manager can print a shelf label straight from the catalog.
            <ProductVariantTable
              variants={product.variants}
              showFinancials={showFinancials}
              showLabelActions
              productName={product.name}
            />
          )}
          {tab === "pricing" && (
            <div className="flex flex-col gap-4">
              <ProductPriceCard
                minSelling={product.rollup.minSellingPrice}
                maxSelling={product.rollup.maxSellingPrice}
                minMrp={null}
                maxMrp={null}
                avgMargin={product.rollup.avgMargin ?? null}
                showFinancials={showFinancials}
              />
              {renderPricingDetail?.(product.id)}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ReadOnlyBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-800 dark:bg-blue-900/15">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <div>
        <div className="font-medium text-blue-800 dark:text-blue-300">Manager View</div>
        <p className="text-blue-700/80 dark:text-blue-300/70">
          Product information is read-only. Catalog, pricing, and inventory changes require Owner
          access.
        </p>
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "variants", label: "Variants" },
    { id: "pricing", label: "Pricing" },
  ];
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === t.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Overview({ product }: { product: ProductDetail }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
      <ProductImageGallery images={product.imageUrls} alt={product.name} />

      <div className="flex flex-col gap-3 text-sm">
        {product.description && <p className="text-muted-foreground">{product.description}</p>}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Field label="Category" value={product.category?.name ?? "—"} />
          <Field label="Brand" value={product.brand?.name ?? "—"} />
          <Field label="Variants" value={String(product.rollup.variantCount)} />
          <Field label="Total Stock" value={String(product.rollup.totalStock)} />
          <CopyField label="SKU" value={product.variants[0]?.sku ?? null} />
          <CopyField label="Barcode" value={product.variants[0]?.barcode ?? null} />
          <Field label="Created" value={fmtDate(product.createdAt)} />
          <Field label="Last Updated" value={fmtDate(product.updatedAt)} />
        </dl>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 font-mono text-xs">
        {value ?? "—"}
        {value && (
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={copy} aria-label={`Copy ${label}`}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </dd>
    </div>
  );
}
