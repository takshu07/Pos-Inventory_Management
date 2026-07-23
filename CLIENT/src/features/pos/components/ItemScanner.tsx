import React, { useState } from "react";
import { Barcode, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui";
import { apiClient } from "@/lib/api/axios";
import { toast } from "sonner";
import { usePosStore } from "../store/usePosStore";
import { PosVariant } from "../types/pos.types";

/**
 * Barcode entry for the sale flow. On Enter, looks up the variant and appends it
 * to the cart — "keeps on filling as the cashier scans" from the design.
 */
export function ItemScanner() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const addItem = usePosStore((s) => s.addItem);

  const scan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !code.trim()) return;
    setBusy(true);
    try {
      const res = await apiClient.get<any, { data: PosVariant }>(
        `/product-variants/barcode/${code.trim()}`
      );
      const variant = res.data;
      if (!variant) {
        toast.error("No product found for that code.");
        return;
      }
      if (variant.currentStock <= 0) {
        toast.error(`${variant.product.name} is out of stock.`);
        return;
      }
      addItem(variant);
      setCode("");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to look up the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      {busy ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      )}
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={scan}
        placeholder="Scan here — item code / barcode"
        className="pl-9 h-12 text-base bg-background"
        disabled={busy}
        autoFocus
      />
      <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
    </div>
  );
}
