import React, { useState } from "react";
import { Search, Barcode, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api/axios";
import { toast } from "sonner";
import { usePosStore, PosReturnedItem } from "../store/usePosStore";
import { PosVariant } from "../types/pos.types";
import { useSalesHistory } from "@/features/sales/hooks/useSales";

export function ExchangeScanner() {
  const [barcode, setBarcode] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const { customer, addExchangeReturn, cart } = usePosStore();
  
  // We preload sales data so it's ready when they scan
  const { data: salesData } = useSalesHistory({ customerId: customer?.id, limit: 10 });

  const handleScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && barcode.trim()) {
      setIsScanning(true);
      try {
        // 1. Find the variant
        const variantResponse = await apiClient.get<any, { data: PosVariant }>(`/product-variants/barcode/${barcode.trim()}`);
        const variant = variantResponse.data;

        if (!variant) {
          toast.error("Variant not found.");
          setIsScanning(false);
          return;
        }

        // 2. Validate Customer
        if (!customer?.id) {
          toast.error("Please select a customer first.");
          setIsScanning(false);
          return;
        }

        // 3. Find eligible sale
        let foundSaleId = null;
        let originalSaleItem = null;
        let isWithin3Days = false;

        const sales = salesData?.items || [];
        for (const sale of sales) {
          if (sale.status !== "COMPLETED" && sale.status !== "PARTIAL") continue;

          const saleDate = new Date(sale.createdAt);
          const diffDays = Math.ceil(Math.abs(new Date().getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24));
          
          const matchingItem = sale.items.find((item: any) => item.variantId === variant.id);
          
          if (matchingItem) {
            if (diffDays <= 3) {
              foundSaleId = sale.id;
              originalSaleItem = matchingItem;
              isWithin3Days = true;
              break;
            } else {
              // Found the item, but too old
              foundSaleId = sale.id; 
              originalSaleItem = matchingItem;
            }
          }
        }

        if (!foundSaleId) {
          toast.error("This item was not found in the customer's recent purchases.");
          setIsScanning(false);
          return;
        }

        if (!isWithin3Days) {
          toast.error("Exchange rejected: Purchase is older than 3 days.");
          setIsScanning(false);
          return;
        }

        // 4. MRP Rule Validation (Replacement >= Returned)
        // Check if there's at least one item in the cart with an MRP >= this returned item's MRP
        const returnedMrp = Number(variant.mrp);
        const hasEligibleReplacement = cart.some(item => Number(item.variant.mrp) >= returnedMrp);
        
        if (cart.length > 0 && !hasEligibleReplacement) {
          toast.error(`MRP Rule Failed: New item MRP must be >= ₹${returnedMrp}`);
          setIsScanning(false);
          return;
        }

        // 5. Add to returns
        const newReturn: PosReturnedItem = {
          cartItemId: crypto.randomUUID(),
          variant,
          quantity: 1, // Assume 1 for scan, can implement qty logic later
          originalSaleId: foundSaleId,
          mrp: returnedMrp
        };

        addExchangeReturn(newReturn);
        setBarcode("");
        toast.success("Returned item added");
      } catch (error: any) {
        toast.error(error.response?.data?.message || "Failed to lookup barcode");
      } finally {
        setIsScanning(false);
      }
    }
  };

  return (
    <div className="relative">
      {isScanning ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 animate-spin" />
      ) : (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
      )}
      <Input
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={handleScan}
        placeholder="Scan Old Product Tag..."
        className="pl-9 bg-background shadow-sm border-orange-500/30 focus-visible:ring-orange-500 text-sm"
        disabled={isScanning}
      />
      <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 opacity-50" />
    </div>
  );
}
