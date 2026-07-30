/** Slow Moving (/admin/inventory/slow-moving). Thin binding over VelocityPage. */
import { VelocityPage } from "./VelocityPage";

export default function SlowMovingPage() {
  return <VelocityPage bucket="SLOW_MOVING" />;
}
