import React, { useState, useEffect, useRef } from "react";
import { User, UserPlus, ArrowRight, CheckCircle, Package, CreditCard, Search } from "lucide-react";
import { Input, Button, Card } from "@/components/ui";
import { useCustomerByPhone, useCreateCustomer } from "@/features/customers/hooks/useCustomers";
import { usePosStore } from "../store/usePosStore";
import { CheckoutStepper } from "./CheckoutStepper";
import { toast } from "sonner";



function EnterpriseCustomerCard({ customer }: { customer: any }) {
  const totalOrders = customer.statistics?.totalOrders || customer.totalPurchases || 0;
  const lifetimeSpend = Number(customer.statistics?.lifetimeSpend || customer.totalSpent || 0);
  const lastPurchase = customer.statistics?.lastVisit || customer.lastPurchaseDate;

  return (
    <div className="mt-4 border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
      <div className="bg-primary/5 p-4 border-b flex justify-between items-center">
        <div>
          <h3 className="font-bold text-lg">{customer.name}</h3>
          <p className="text-sm text-muted-foreground">{customer.phone}</p>
        </div>
        <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          {totalOrders > 10 ? 'VIP Customer' : 'Regular Customer'}
        </div>
      </div>
      <div className="p-4 bg-background grid grid-cols-2 gap-4 text-sm">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Lifetime Purchases</span>
          <span className="font-semibold text-lg text-primary">₹{lifetimeSpend.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Total Orders</span>
          <span className="font-medium text-lg">{totalOrders}</span>
        </div>
        <div className="flex flex-col col-span-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Last Purchase</span>
          <span className="font-medium text-sm">
            {lastPurchase 
              ? new Date(lastPurchase).toLocaleDateString('en-IN', { dateStyle: 'long' }) 
              : 'Never'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CustomerEntryScreen() {
  const { startSession, customer } = usePosStore();
  const createCustomerMutation = useCreateCustomer();
  
  const [phone, setPhone] = useState(customer?.phone || "");
  const [name, setName] = useState(customer?.name || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isValidPhone = phone.length === 10;
  
  // Auto-lookup when phone is valid length
  const { data: foundCustomer, isFetching } = useCustomerByPhone(isValidPhone ? phone : "");

  useEffect(() => {
    if (foundCustomer) {
      setName(foundCustomer.name);
    } else if (!isValidPhone) {
      setName("");
    } else if (isValidPhone && !isFetching && !foundCustomer) {
      // New customer - auto focus name
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
    }
  }, [foundCustomer, isValidPhone, isFetching]);

  const handleContinue = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValidPhone) return;
    
    if (foundCustomer) {
      startSession({
        id: foundCustomer.id,
        phone,
        name: foundCustomer.name
      });
      return;
    }
    
    if (!name.trim()) {
      toast.error("Please enter a Customer Name.");
      nameInputRef.current?.focus();
      return;
    }
    
    // Create new customer
    try {
      setIsSubmitting(true);
      const newCustomerData = await createCustomerMutation.mutateAsync({
        phone,
        name: name.trim()
      });
      
      toast.success("Customer created successfully");
      startSession({
        id: newCustomerData.id,
        phone,
        name: newCustomerData.name
      });
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || "Failed to create customer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleContinue();
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-muted/20 overflow-y-auto">
      <div className="w-full p-6 pt-10 mb-2">
        <CheckoutStepper currentStep={0} />
      </div>
      
      <div className="flex-1 flex items-start justify-center pb-10 pt-4 px-4">
        <Card className="w-full max-w-md p-8 shadow-xl flex flex-col gap-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight">Customer Identification</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Enter mobile number to begin transaction
            </p>
          </div>

          <form onSubmit={handleContinue} className="flex flex-col gap-5 mt-2">
            <div>
              <Input
                label="Mobile Number"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={handleKeyDown}
                maxLength={10}
                autoFocus
                className="text-xl h-14 tracking-wider"
                disabled={isFetching || isSubmitting}
                icon={isFetching ? <Search className="w-5 h-5 animate-pulse text-muted-foreground" /> : undefined}
              />
            </div>

            {isValidPhone && !isFetching && foundCustomer && (
              <EnterpriseCustomerCard customer={foundCustomer} />
            )}

            {isValidPhone && !isFetching && !foundCustomer && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-md mb-4 flex items-start gap-2 text-orange-700 dark:text-orange-400 text-sm font-medium">
                  <UserPlus className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Customer not found. Creating a new profile.</span>
                </div>
                <Input
                  ref={nameInputRef}
                  id="customer-name-input"
                  label="Customer Name"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSubmitting}
                  className="text-lg h-12"
                  required
                />
              </div>
            )}

            <div className="mt-4">
              <Button 
                type="button"
                onClick={handleContinue}
                size="lg" 
                className="w-full text-lg h-14 transition-all"
                disabled={!isValidPhone || (isValidPhone && !foundCustomer && !name.trim()) || isFetching || isSubmitting}
                loading={isFetching || isSubmitting}
              >
                {foundCustomer ? "Continue" : "Save & Continue"} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
