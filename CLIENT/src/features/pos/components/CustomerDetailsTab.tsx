import React, { useState, useEffect, useRef } from "react";
import { UserPlus, Search, ArrowRight, ShoppingBag } from "lucide-react";
import { Input, Button } from "@/components/ui";
import { useCustomerByPhone, useCreateCustomer } from "@/features/customers/hooks/useCustomers";
import { useSalesHistory } from "@/features/sales/hooks/useSales";
import { useShallow } from "zustand/react/shallow";
import { usePosStore } from "../store/usePosStore";
import { formatCurrency } from "../utils/pos.utils";
import { ExchangeSummaryLine } from "@/features/sales/components/Invoice/ExchangeSection";
import { toast } from "sonner";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/** Left panel: identify or create the customer. */
function CustomerForm() {
  const { customer, startSession, setCustomer } = usePosStore(
    useShallow((s) => ({
      customer: s.customer,
      startSession: s.startSession,
      setCustomer: s.setCustomer,
    }))
  );
  const createCustomer = useCreateCustomer();

  const [phone, setPhone] = useState(customer?.phone || "");
  const [name, setName] = useState(customer?.name || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isValidPhone = phone.length === 10;
  const { data: found, isFetching } = useCustomerByPhone(isValidPhone ? phone : "");

  // Auto-fill the name / focus for a new customer.
  useEffect(() => {
    if (found) {
      setName(found.name);
      setCustomer({ id: found.id, name: found.name, phone: found.phone });
    } else if (!isValidPhone) {
      setName("");
    } else if (isValidPhone && !isFetching && !found) {
      setTimeout(() => nameRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, isValidPhone, isFetching]);

  const proceed = async () => {
    if (!isValidPhone) return;
    if (found) {
      startSession({ id: found.id, phone, name: found.name });
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a customer name.");
      nameRef.current?.focus();
      return;
    }
    try {
      setIsSubmitting(true);
      const created = await createCustomer.mutateAsync({ phone, name: name.trim() });
      toast.success("Customer saved.");
      startSession({ id: created.id, phone, name: created.name });
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to save customer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      proceed();
    }
  };

  const stats = found?.statistics;

  return (
    <div className="flex flex-col gap-5 p-5 h-full">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Customer details</h2>
        <p className="text-sm text-muted-foreground">Enter the mobile number to begin.</p>
      </div>

      <Input
        label="Mobile"
        placeholder="10-digit mobile number"
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
        onKeyDown={onKey}
        maxLength={10}
        autoFocus
        className="text-lg h-12 tracking-wider"
        disabled={isFetching || isSubmitting}
        rightElement={isFetching ? <Search className="w-4 h-4 animate-pulse" /> : undefined}
      />

      <Input
        ref={nameRef}
        label="Name"
        placeholder="Customer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKey}
        disabled={isSubmitting || (isValidPhone && !!found)}
        className="h-11"
      />

      {/* first / last visit — empty for a new customer, auto-filled for a returning one */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3 bg-muted/20">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">First visit</div>
          <div className="font-medium mt-1">{fmtDate(stats?.firstVisit)}</div>
        </div>
        <div className="rounded-lg border p-3 bg-muted/20">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Last visit</div>
          <div className="font-medium mt-1">{fmtDate(stats?.lastVisit)}</div>
        </div>
      </div>

      {isValidPhone && !isFetching && !found && (
        <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-md flex items-start gap-2 text-orange-700 dark:text-orange-400 text-sm font-medium">
          <UserPlus className="w-4 h-4 mt-0.5 shrink-0" />
          <span>New customer — fill the name and save.</span>
        </div>
      )}

      <div className="mt-auto">
        <Button
          onClick={proceed}
          className="w-full h-12 text-base"
          disabled={!isValidPhone || (!found && !name.trim()) || isFetching || isSubmitting}
          loading={isFetching || isSubmitting}
        >
          {found ? "Continue to items" : "Save & continue"} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Right panel: previous purchases of the identified customer (empty if new). */
function PreviousPurchases() {
  const customer = usePosStore((s) => s.customer);
  const customerId = customer?.id;
  const { data, isLoading } = useSalesHistory({ customerId, limit: 20 });
  const bills = data?.data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b shrink-0">
        <h3 className="font-semibold">Previous purchases of this customer</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!customerId ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2 opacity-70">
            <ShoppingBag className="h-10 w-10" />
            <p>Identify a customer to see their history.</p>
          </div>
        ) : isLoading ? (
          <div className="text-sm text-muted-foreground p-3">Loading…</div>
        ) : bills.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2 opacity-70">
            <ShoppingBag className="h-10 w-10" />
            <p>No purchases yet — new customer.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bills.map((b, i) => (
              <div key={b.id} className="rounded-lg border p-3 bg-background flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-muted-foreground w-5">{i + 1}</span>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{b.invoiceNumber}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(b.date).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                        {b.paymentMethods.length > 0 && ` · ${b.paymentMethods.join(", ")}`}
                      </span>
                    </div>
                  </div>
                  <span className="font-semibold text-sm">{formatCurrency(b.totalAmount)}</span>
                </div>
                {b.exchanges.length > 0 && (
                  <div className="flex flex-col gap-1.5 pl-8">
                    {b.exchanges.map((ex) => (
                      <ExchangeSummaryLine key={ex.id} exchange={ex} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomerDetailsTab() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(340px,420px)_1fr] h-full min-h-0 divide-y lg:divide-y-0 lg:divide-x">
      <CustomerForm />
      <PreviousPurchases />
    </div>
  );
}
