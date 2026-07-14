import React, { useState, useEffect } from "react";
import { User, UserPlus, ArrowRight, SkipForward } from "lucide-react";
import { Input, Button, Card } from "@/components/ui";
import { useCustomerByPhone } from "@/features/customers/hooks/useCustomers";
import { usePosStore } from "../store/usePosStore";
import { toast } from "sonner";

export function CustomerEntryScreen() {
  const { startSession } = usePosStore();
  
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  
  // Try to lookup customer when phone is valid length
  const { data: foundCustomer, isFetching } = useCustomerByPhone(phone.length >= 10 ? phone : "");

  useEffect(() => {
    if (foundCustomer) {
      setName(foundCustomer.name);
    } else if (phone.length < 10) {
      setName(""); // Clear name if they delete phone
    }
  }, [foundCustomer, phone]);

  const handleStart = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (phone.length >= 10) {
      if (!foundCustomer && !name.trim()) {
        toast.error("Please enter a Customer Name for new customers.");
        return;
      }
      
      startSession({
        id: foundCustomer?.id,
        phone,
        name,
      });
    } else if (phone.length > 0) {
      toast.error("Please enter a valid 10-digit mobile number.");
    }
  };

  const handleWalkIn = () => {
    startSession(null); // Walk-in
  };

  return (
    <div className="h-full w-full flex items-center justify-center bg-muted/20">
      <Card className="w-full max-w-md p-8 shadow-xl flex flex-col gap-6">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <User className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">Customer Entry</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Enter mobile number to identify or create customer.
          </p>
        </div>

        <form onSubmit={handleStart} className="flex flex-col gap-4">
          <div>
            <Input
              label="Mobile Number"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              maxLength={15}
              autoFocus
              className="text-lg h-12"
              disabled={isFetching}
            />
          </div>

          {phone.length >= 10 && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <Input
                label="Customer Name"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!foundCustomer || isFetching}
                className="text-lg h-12"
                required
              />
              {foundCustomer ? (
                <p className="text-sm text-emerald-500 font-medium mt-2 flex items-center gap-1">
                  ✓ Existing Customer Found
                </p>
              ) : (
                <p className="text-sm text-primary font-medium mt-2 flex items-center gap-1">
                  <UserPlus className="h-4 w-4" /> New Customer
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-4">
            <Button 
              type="submit" 
              size="lg" 
              className="w-full text-lg h-12"
              disabled={phone.length > 0 && phone.length < 10}
              loading={isFetching}
            >
              Start Transaction <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground text-xs uppercase font-medium">Or</span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <Button 
              type="button" 
              variant="outline" 
              size="lg" 
              className="w-full text-muted-foreground"
              onClick={handleWalkIn}
            >
              Skip as Walk-in <SkipForward className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
