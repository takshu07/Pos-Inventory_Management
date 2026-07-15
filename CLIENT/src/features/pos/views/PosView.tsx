import { usePosStore } from "../store/usePosStore";
import { PosLayout } from "../components/PosLayout";
import { PosLeftSection } from "../components/PosLeftSection";
import { PosRightSection } from "../components/PosRightSection";
import { CustomerEntryScreen } from "../components/CustomerEntryScreen";
import { CheckoutStepper } from "../components/CheckoutStepper";

import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui";

export default function PosView() {
  const { isSessionStarted, checkoutStep, clearCart } = usePosStore();

  if (!isSessionStarted && checkoutStep !== 3) {
    return <CustomerEntryScreen />;
  }

  return (
    <div className="h-full w-full bg-background flex flex-col">
      <div className="w-full p-4 shrink-0 bg-muted/30 border-b">
        <CheckoutStepper currentStep={checkoutStep} />
      </div>
      
      {checkoutStep === 3 ? (
        <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in-95 duration-500">
          <CheckCircle className="w-32 h-32 text-green-500 mb-6 drop-shadow-md" />
          <h1 className="text-5xl font-black tracking-tight text-foreground mb-4">Transaction Complete</h1>
          <p className="text-xl text-muted-foreground mb-10">The payment was successfully processed.</p>
          <Button 
            size="lg" 
            onClick={() => clearCart()} 
            className="text-lg h-14 px-10 shadow-lg"
          >
            Start New Transaction
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <PosLayout 
            left={<PosLeftSection />} 
            right={<PosRightSection />} 
          />
        </div>
      )}
    </div>
  );
}
