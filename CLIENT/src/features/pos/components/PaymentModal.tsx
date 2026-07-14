import { useState, useEffect, useMemo } from "react";
import { Modal, Button, Input } from "@/components/ui";
import { formatCurrency } from "../utils/pos.utils";
import type { PaymentMethod } from "../types/pos.types";
import { Trash2 } from "lucide-react";

interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  amount: number;
  transactionRef?: string;
}

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  onConfirm: (payload: { method: PaymentMethod; amount: number; transactionRef?: string }[]) => void;
  isProcessing: boolean;
}

export function PaymentModal({ open, onClose, grandTotal, onConfirm, isProcessing }: PaymentModalProps) {
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amountInput, setAmountInput] = useState<string>("");
  const [transactionRef, setTransactionRef] = useState("");

  // Derived calculations
  const totalPaid = useMemo(() => entries.reduce((sum, entry) => sum + entry.amount, 0), [entries]);
  const remaining = Math.max(0, grandTotal - totalPaid);
  const changeDue = Math.max(0, totalPaid - grandTotal);
  
  // Calculate how much cash was paid vs non-cash for change calculation rule checking
  const nonCashPaid = useMemo(() => entries.filter(e => e.method !== "CASH").reduce((sum, e) => sum + e.amount, 0), [entries]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setEntries([]);
      setMethod("CASH");
      setAmountInput(grandTotal.toString());
      setTransactionRef("");
    }
  }, [open, grandTotal]);

  // Auto-fill remaining amount when it changes (and is greater than 0)
  useEffect(() => {
    if (remaining > 0) {
      setAmountInput(remaining.toString());
    } else {
      setAmountInput("");
    }
  }, [remaining]);

  const handleAddPayment = () => {
    const amountNum = Number(amountInput);
    if (!amountNum || amountNum <= 0) return;

    // Rule: Non-cash payments cannot exceed the remaining balance.
    if (method !== "CASH" && amountNum > remaining) {
      // In a real app we might show a toast here, but UI logic disables the button anyway
      return; 
    }

    setEntries(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        method,
        amount: amountNum,
        transactionRef: method !== "CASH" ? transactionRef : undefined
      }
    ]);
    setTransactionRef("");
  };

  const handleRemoveEntry = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const handleConfirm = () => {
    // Only pass the entry payload
    const payload = entries.map(e => ({
      method: e.method,
      amount: e.amount,
      transactionRef: e.transactionRef
    }));
    onConfirm(payload);
  };

  const amountNum = Number(amountInput) || 0;
  
  // Validation for adding a new entry
  const canAdd = 
    amountNum > 0 && 
    (method === "CASH" || amountNum <= remaining) && 
    remaining > 0;

  // Validation for completing the sale
  const canConfirm = 
    totalPaid >= grandTotal && 
    entries.length > 0 && 
    // Ensure non-cash didn't overpay (if they somehow bypassed UI)
    nonCashPaid <= grandTotal;

  return (
    <Modal open={open} onClose={onClose} title="Complete Payment" size="lg">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
        
        {/* Left Side: Payment Builder */}
        <div className="flex flex-col gap-5 border-r md:pr-6 border-border/50">
          
          <div className="flex flex-col items-start justify-center p-4 bg-muted/30 rounded-xl border border-border/50">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Invoice Total</span>
            <span className="text-3xl font-bold text-foreground">{formatCurrency(grandTotal)}</span>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "UPI", "CARD"] as PaymentMethod[]).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={method === m ? "default" : "outline"}
                  onClick={() => setMethod(m)}
                  disabled={remaining === 0}
                >
                  {m}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Input
              label="Amount (₹)"
              type="number"
              min="0.01"
              step="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="text-lg font-medium"
              disabled={remaining === 0}
              autoFocus
            />

            {method !== "CASH" && (
              <Input
                label="Transaction Reference (Optional)"
                placeholder="e.g. UTR Number or Last 4 digits"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
                disabled={remaining === 0}
              />
            )}

            <Button 
              variant="secondary" 
              className="w-full" 
              onClick={handleAddPayment} 
              disabled={!canAdd}
            >
              Add Payment Entry
            </Button>
          </div>
        </div>

        {/* Right Side: Ledger & Summary */}
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Payment Ledger</h3>
          
          {/* Ledger List */}
          <div className="flex-1 overflow-y-auto min-h-[150px] bg-muted/20 border border-border/50 rounded-lg p-2 flex flex-col gap-2">
            {entries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic opacity-70">
                No payments added yet
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-3 bg-background border rounded-md shadow-sm">
                  <div className="flex flex-col">
                    <span className="font-semibold">{entry.method}</span>
                    {entry.transactionRef && (
                      <span className="text-xs text-muted-foreground">Ref: {entry.transactionRef}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">{formatCurrency(entry.amount)}</span>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveEntry(entry.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Ledger Summary */}
          <div className="flex flex-col gap-2 mt-4 p-4 rounded-xl border border-border/50 bg-muted/10">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Paid:</span>
              <span className="font-medium text-foreground">{formatCurrency(totalPaid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining:</span>
              <span className="font-medium text-foreground">{formatCurrency(remaining)}</span>
            </div>
            {changeDue > 0 && (
              <>
                <div className="border-t border-dashed my-1"></div>
                <div className="flex justify-between items-center text-success font-semibold">
                  <span>Change Due:</span>
                  <span className="text-lg">{formatCurrency(changeDue)}</span>
                </div>
              </>
            )}
          </div>
        </div>

      </div>
      <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
        <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
          Cancel
        </Button>
        <Button 
          onClick={handleConfirm} 
          disabled={!canConfirm || isProcessing}
          loading={isProcessing}
        >
          Confirm Payment
        </Button>
      </div>
    </Modal>
  );
}
