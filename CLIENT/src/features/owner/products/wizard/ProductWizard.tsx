import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, Check, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { WizardProvider, useWizard } from "./WizardContext";
import { WIZARD_STEPS } from "./types";
import { ProgressHeader } from "./components/ProgressHeader";
import { isStepValid, stepErrors, hasBlockingErrors } from "./validation";
import { buildCreatePayload } from "./transform";
import { useCreateFullProduct } from "../hooks/useOwnerProducts";
import { BasicInfoStep } from "./steps/BasicInfoStep";
import { ImagesStep } from "./steps/ImagesStep";
import { AttributesStep } from "./steps/AttributesStep";
import { VariantGeneratorStep } from "./steps/VariantGeneratorStep";
import { VariantDetailsStep } from "./steps/VariantDetailsStep";
import { InventoryStep } from "./steps/InventoryStep";
import { SupplierStep } from "./steps/SupplierStep";
import { PricingStep } from "./steps/PricingStep";
import { ReviewStep } from "./steps/ReviewStep";

/**
 * ProductWizard — the enterprise product-creation flow. Full-screen guided
 * wizard: progress header, per-step validation gating, keyboard nav, draft
 * autosave, and a single transactional create at the end. Rendered only for
 * OWNER (mounted from OwnerProductsPage, which is behind OwnerRoute).
 *
 * Step order comes from WIZARD_STEPS; this switch is keyed by step.key so the
 * sequence can be reordered there without touching this file. Pricing is
 * collected once (PricingStep) and inherited by every variant — VariantDetails
 * is purely an inventory/SKU screen.
 */
export function ProductWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (productId: string) => void;
}) {
  if (!open) return null;
  return (
    <WizardProvider>
      <WizardShell onClose={onClose} onCreated={onCreated} />
    </WizardProvider>
  );
}

function WizardShell({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (productId: string) => void;
}) {
  const { state, lastSavedAt, clearDraft, hasDraft } = useWizard();
  const [index, setIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const createMut = useCreateFullProduct();

  const step = WIZARD_STEPS[index]!;
  const isLast = index === WIZARD_STEPS.length - 1;
  const currentErrors = stepErrors(step.key, state);
  const canAdvance = isStepValid(step.key, state);

  const goNext = () => {
    if (isLast) return;
    if (!canAdvance) {
      toast.error(currentErrors[0] ?? "Please complete this step.");
      return;
    }
    const next = index + 1;
    setIndex(next);
    setFurthest((f) => Math.max(f, next));
  };
  const goBack = () => setIndex((i) => Math.max(0, i - 1));

  // Keyboard: Ctrl/Cmd+Enter advances; Escape closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (isLast) void submit();
        else goNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, state]);

  const submit = async () => {
    if (hasBlockingErrors(state)) {
      toast.error("Fix the highlighted errors before creating the product.");
      return;
    }
    try {
      const payload = buildCreatePayload(state);
      const product = await createMut.mutateAsync(payload);
      toast.success("Product created with variants and opening stock.");
      clearDraft();
      onCreated((product as { id: string }).id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create product.");
    }
  };

  const StepBody = useMemo(() => {
    switch (step.key) {
      case "basic":
        return <BasicInfoStep />;
      case "images":
        return <ImagesStep />;
      case "attributes":
        return <AttributesStep />;
      case "variants":
        return <VariantGeneratorStep />;
      case "details":
        return <VariantDetailsStep />;
      case "inventory":
        return <InventoryStep />;
      case "supplier":
        return <SupplierStep />;
      case "pricing":
        return <PricingStep />;
      case "review":
        return <ReviewStep />;
      default:
        return null;
    }
  }, [step.key]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight">New Product</h1>
          <p className="text-xs text-muted-foreground">
            {hasDraft && lastSavedAt
              ? `Draft autosaved ${lastSavedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
              : "Guided product creation"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasDraft && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm("Discard this draft and start over?")) clearDraft();
              }}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Discard draft
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close wizard">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <ProgressHeader
        activeIndex={index}
        furthestIndex={furthest}
        onStepClick={(i) => setIndex(i)}
      />

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">{StepBody}</div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
        <Button variant="outline" onClick={goBack} disabled={index === 0} leftIcon={<ChevronLeft className="h-4 w-4" />}>
          Back
        </Button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Step {index + 1} of {WIZARD_STEPS.length}</span>
        </div>

        {isLast ? (
          <Button
            onClick={submit}
            loading={createMut.isPending}
            disabled={hasBlockingErrors(state)}
            leftIcon={!createMut.isPending ? <Check className="h-4 w-4" /> : undefined}
          >
            Create Product
          </Button>
        ) : (
          <Button
            onClick={goNext}
            disabled={!canAdvance}
            rightIcon={<ChevronRight className="h-4 w-4" />}
            className={cn(!canAdvance && "opacity-60")}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
