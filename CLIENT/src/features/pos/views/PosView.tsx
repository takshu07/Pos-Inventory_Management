import { usePosStore } from "../store/usePosStore";
import { PosLayout } from "../components/PosLayout";
import { PosLeftSection } from "../components/PosLeftSection";
import { PosRightSection } from "../components/PosRightSection";
import { CustomerEntryScreen } from "../components/CustomerEntryScreen";

export default function PosView() {
  const { isSessionStarted } = usePosStore();

  if (!isSessionStarted) {
    return <CustomerEntryScreen />;
  }

  return (
    <div className="h-full w-full bg-background">
      <PosLayout 
        left={<PosLeftSection />} 
        right={<PosRightSection />} 
      />
    </div>
  );
}
