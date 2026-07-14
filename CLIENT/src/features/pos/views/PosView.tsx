import { PosLayout } from "../components/PosLayout";
import { PosLeftSection } from "../components/PosLeftSection";
import { PosRightSection } from "../components/PosRightSection";

export default function PosView() {
  return (
    <div className="h-full w-full bg-background">
      <PosLayout 
        left={<PosLeftSection />} 
        right={<PosRightSection />} 
      />
    </div>
  );
}
