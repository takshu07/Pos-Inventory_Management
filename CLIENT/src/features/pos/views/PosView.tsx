import { usePosStore } from "../store/usePosStore";
import { PosToolbar } from "../components/PosToolbar";
import { PosTabs } from "../components/PosTabs";
import { CustomerDetailsTab } from "../components/CustomerDetailsTab";
import { ItemDetailsTab } from "../components/ItemDetailsTab";
import { ListOfBillsTab } from "../components/ListOfBillsTab";

/**
 * Single cashier workspace matching the design:
 *  - Static toolbar   [ Add · Print · Save only · Save & Print ]
 *  - Static tab bar    [ Customer details · Item details · List of bills ]
 *  - Active tab body
 */
export default function PosView() {
  const { activeTab } = usePosStore();

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <PosToolbar />
      <PosTabs />
      <div className="flex-1 min-h-0">
        {activeTab === "CUSTOMER" && <CustomerDetailsTab />}
        {activeTab === "ITEMS" && <ItemDetailsTab />}
        {activeTab === "BILLS" && <ListOfBillsTab />}
      </div>
    </div>
  );
}
