import { User, Package, ReceiptText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePosStore, PosTab } from "../store/usePosStore";
import { toast } from "sonner";

const TABS: { key: PosTab; label: string; icon: React.ReactNode }[] = [
  { key: "CUSTOMER", label: "Customer details", icon: <User className="h-4 w-4" /> },
  { key: "ITEMS", label: "Item details", icon: <Package className="h-4 w-4" /> },
  { key: "BILLS", label: "List of bills", icon: <ReceiptText className="h-4 w-4" /> },
];

/**
 * Static section 2 from the design — the workspace tab bar.
 * The Item details tab is locked until a customer is attached.
 */
export function PosTabs() {
  const { activeTab, setActiveTab, isSessionStarted, sessionBills } = usePosStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      isSessionStarted: s.isSessionStarted,
      sessionBills: s.sessionBills,
    }))
  );

  const handleClick = (tab: PosTab) => {
    if (tab === "ITEMS" && !isSessionStarted) {
      toast.error("Attach a customer first (Customer details tab).");
      return;
    }
    setActiveTab(tab);
  };

  return (
    <div className="flex items-stretch border-b bg-background shrink-0">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        const locked = tab.key === "ITEMS" && !isSessionStarted;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleClick(tab.key)}
            className={`
              relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors
              ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}
              ${locked ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            {tab.icon}
            {tab.label}
            {tab.key === "BILLS" && sessionBills.length > 0 && (
              <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full">
                {sessionBills.length}
              </span>
            )}
            {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}
