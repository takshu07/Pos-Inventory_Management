/** Fast Moving (/admin/inventory/fast-moving). Thin binding over VelocityPage. */
import { VelocityPage } from "./VelocityPage";

export default function FastMovingPage() {
  return <VelocityPage bucket="FAST_MOVING" />;
}
