import React, { useState, useEffect } from "react";
import { useSearchVariants } from "@/features/pos/api/pos.api";
import { useExchangeStore } from "../store/useExchangeStore";
import { Trash2, Search, Barcode, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrency } from "@/features/pos/utils/pos.utils";
import { PosVariant } from "@/features/pos/types/pos.types";

export function ExchangeCart() {
  const { issuedItems, addIssuedItem, removeIssuedItem } = useExchangeStore();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading } = useSearchVariants(debouncedQuery);

  const handleProductSelect = (variant: PosVariant) => {
    addIssuedItem(variant, 1);
    setSearchQuery("");
    setIsFocused(false);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="relative z-10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            placeholder="Search by Name, SKU, or scan Barcode..."
            className="pl-9 bg-background shadow-sm text-base"
            autoFocus
          />
          <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4 opacity-50" />
        </div>
        
        {isFocused && searchQuery.length > 2 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-popover border shadow-md rounded-md overflow-hidden max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Searching...</div>
            ) : searchResults && searchResults.length > 0 ? (
              searchResults.map(variant => (
                <div 
                  key={variant.id} 
                  className="p-3 border-b last:border-0 hover:bg-muted cursor-pointer flex justify-between items-center"
                  onClick={() => handleProductSelect(variant)}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-sm text-foreground">{variant.product?.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {variant.size?.name || "N/A"} • {variant.color?.name || "N/A"} | SKU: {variant.sku}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-sm text-primary">{formatCurrency(Number(variant.sellingPrice))}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6 rounded-full bg-primary/10 text-primary">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-sm text-muted-foreground">No matching products found.</div>
            )}
          </div>
        )}
      </div>
      
      <div className="flex flex-col gap-2 mt-4 flex-1 overflow-y-auto pr-2">
        {issuedItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border border-dashed rounded-lg">
            Scan or search items to issue
          </div>
        ) : (
          issuedItems.map((item) => (
            <div key={item.cartItemId} className="flex justify-between items-center p-3 border rounded-lg bg-card">
              <div className="flex flex-col">
                <span className="font-medium text-sm">{item.variant.product?.name || "Unknown"}</span>
                <span className="text-xs text-muted-foreground mt-0.5">
                  {item.variant.size?.name || "N/A"} • {item.variant.color?.name || "N/A"} | Qty: {item.quantity}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-semibold text-sm">{formatCurrency(item.lineTotal)}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-muted-foreground hover:text-destructive h-8 w-8"
                  onClick={() => removeIssuedItem(item.cartItemId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
