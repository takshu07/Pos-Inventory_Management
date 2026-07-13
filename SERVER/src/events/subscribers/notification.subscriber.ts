import { EventBus } from "../eventBus";
import { EventTopic } from "../domainEvents";
import { NotificationEngine } from "../../engines/notification.engine";
import type { InventoryLowPayload, SaleCompletedPayload } from "../domainEvents";
import { EmployeeRole } from "../../../generated/prisma";

export function registerNotificationSubscribers() {
  
  // Subscriber 1: Low Stock Alerts
  EventBus.subscribe(
    EventTopic.INVENTORY_LOW,
    "NotificationEngine_InventoryLow",
    async (event) => {
      const payload = event.payload as InventoryLowPayload;
      
      await NotificationEngine.dispatch({
        type: "LOW_STOCK",
        title: `Low Stock: ${payload.productName}`,
        message: `SKU ${payload.sku} has fallen to ${payload.currentStock} units (Threshold: ${payload.threshold}).`,
        referenceId: payload.variantId,
        referenceType: "ProductVariant",
        targetRole: EmployeeRole.MANAGER // Alert all managers
      });
    },
    100 // High priority
  );

  // Subscriber 2: Large Sales Alert
  EventBus.subscribe(
    EventTopic.SALE_COMPLETED,
    "NotificationEngine_LargeSale",
    async (event) => {
      const payload = event.payload as SaleCompletedPayload;
      
      // Business Rule: Notify Owner if sale is unusually large (e.g., > 10,000)
      if (payload.grandTotal >= 10000) {
        await NotificationEngine.dispatch({
          type: "LARGE_SALE",
          title: "High Value Sale Completed",
          message: `Sale ${payload.saleId} completed for ${payload.grandTotal}.`,
          referenceId: payload.saleId,
          referenceType: "Sale",
          targetRole: EmployeeRole.OWNER
        });
      }
    }
  );

}
