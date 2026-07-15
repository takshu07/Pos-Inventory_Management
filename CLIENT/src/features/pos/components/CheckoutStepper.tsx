import React from "react";
import { User, Package, CreditCard, CheckCircle } from "lucide-react";

interface CheckoutStepperProps {
  currentStep: number;
}

export function CheckoutStepper({ currentStep }: CheckoutStepperProps) {
  const steps = [
    { label: "Customer", icon: <User className="w-4 h-4" /> },
    { label: "Products", icon: <Package className="w-4 h-4" /> },
    { label: "Payment", icon: <CreditCard className="w-4 h-4" /> },
    { label: "Complete", icon: <CheckCircle className="w-4 h-4" /> },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto relative">
      <div className="absolute top-5 left-0 w-full h-0.5 bg-muted/60"></div>
      <div 
        className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-300"
        style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
      ></div>
      <div className="flex items-center justify-between relative z-10">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isPast = index < currentStep;
          
          return (
            <div key={step.label} className="flex flex-col items-center">
              <div 
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors bg-background ${
                  isActive ? "border-primary text-primary" : 
                  isPast ? "border-primary bg-primary/10 text-primary" : 
                  "border-muted text-muted-foreground"
                }`}
              >
                {step.icon}
              </div>
              <span className={`text-xs mt-2 font-medium ${isActive || isPast ? "text-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
