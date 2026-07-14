import { Prisma, ActionModule, MovementType, PaymentStatus, SaleStatus } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { logger } from "../config/logger";
import { executeWithRetry } from "../utils/retry";
import { auditRepository } from "../repositories/audit.repository";
import { productVariantRepository } from "../repositories/productVariant.repository";
import { saleRepository } from "../repositories/sale.repository";
import { PricingEngine, type PricingVariantItem } from "../engines/pricing.engine";
import { PromotionEngine, type PromotionContext } from "../engines/promotion.engine";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { PaymentService } from "./payment.service";
import { InvoiceService } from "./invoice.service";
import { executeMovement } from "./inventoryMovement.service";
import { EventBus } from "../events/eventBus";
import { EventTopic } from "../events/domainEvents";
import type { SaleCompletedPayload } from "../events/domainEvents";
import type { CheckoutInput, ListSalesQuery, VoidSaleInput } from "../validation/sale.validation";

export class SaleService {
  // ============================================================================
  // PUBLIC ORCHESTRATORS
  // ============================================================================

  static async checkout(payload: CheckoutInput, employeeId: string, idempotencyKey: string) {
    // 1. Check Idempotency (Stripe-style duplicate protection)
    const existingSale = await this.checkIdempotency(idempotencyKey);
    if (existingSale) {
      logger.info({ saleId: existingSale.id, idempotencyKey }, "Idempotent checkout hit. Returning cached sale.");
      return this.buildCheckoutResponse(existingSale);
    }

    // 2. Extract and pre-validate database variants (No Prisma in Service)
    const variants = await this.fetchVariants(payload.items);
    this.validateVariants(variants, payload.items);

    // 3. Prepare Context for Enterprise Pricing Engine (Outside Transaction to keep lock short)
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found");
    
    // Enterprise Configuration Retrieval (O(1) Memory Lookup)
    const pricingConfig = ConfigurationEngine.getPricingSettings();
    
    const activePromotions = await prisma.promotion.findMany({ 
      where: { 
        isActive: true,
        OR: [
          { endDate: null },
          { endDate: { gte: new Date() } }
        ],
        AND: [
          { startDate: null },
          { startDate: { lte: new Date() } }
        ]
      } 
    });

    // 4. Execute the core transaction with resiliency
    const saleId = await executeWithRetry(
      () => this.executeCheckoutTransaction(
        payload, variants, employee, activePromotions, pricingConfig.defaultTaxRate, idempotencyKey
      ),
      (error: any) => error?.code === "P2002", // Retry only on Unique Constraint (Invoice collision)
      3 // Max 3 retries
    );

    // 4. Fire-and-forget Audit Log
    this.logCheckoutAudit(saleId, employeeId).catch((err) => {
      logger.error({ err, saleId }, "Failed to log checkout audit");
    });

    // 5. Fetch and map final response
    const completedSale = await saleRepository.findById(saleId);
    if (!completedSale) throw new AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, "Sale vanished after commit");

    // 6. Fire Domain Event asynchronously
    EventBus.publish(
      EventBus.createEvent<SaleCompletedPayload>(
        EventTopic.SALE_COMPLETED,
        completedSale.id,
        "sales",
        {
          saleId: completedSale.id,
          grandTotal: Number(completedSale.grandTotal),
          customerId: completedSale.customer?.id
        },
        employeeId,
        "SaleService"
      )
    ).catch(err => logger.error({ err }, "Failed to publish SALE_COMPLETED"));

    return this.buildCheckoutResponse(completedSale);
  }

  static async listSales(query: ListSalesQuery) {
    // Pass-through wrapper
    return saleRepository.findMany(query);
  }

  static async getSaleById(id: string) {
    const sale = await saleRepository.findById(id);
    if (!sale) throw new AppError(HTTP_STATUS.NOT_FOUND, "Sale not found");
    return this.buildCheckoutResponse(sale);
  }

  static async voidSale(saleId: string, employeeId: string, payload: VoidSaleInput) {
    const sale = await saleRepository.findById(saleId);
    if (!sale) throw new AppError(HTTP_STATUS.NOT_FOUND, "Sale not found");

    if (sale.status === SaleStatus.CANCELLED) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Sale is already voided.");
    }
    if (sale.status === SaleStatus.REFUNDED) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Cannot void a sale that has been returned. Use the returns workflow.");
    }

    await prisma.$transaction(async (tx) => {
      // Update Sale Status
      await tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.CANCELLED, manualDiscountReason: `VOIDED: ${payload.reason}` },
      });

      // Restore Inventory via standard executeMovement
      for (const item of sale.items) {
        await executeMovement(
          {
            variantId: item.variantId,
            quantityChanged: item.quantity, // Positive to restore
            type: MovementType.MANUAL_ADJUSTMENT,
            relatedSaleId: saleId,
            employeeId,
          },
          tx
        );
      }
    });

    // Fire-and-forget audit
    auditRepository.create({
      performedBy: employeeId,
      action: "UPDATE",
      module: ActionModule.SALE,
      tableName: "sales",
      recordId: saleId,
      newData: { reason: payload.reason, previousStatus: sale.status, newStatus: SaleStatus.CANCELLED },
    }).catch((err) => logger.error({ err }, "Failed to log void audit"));

    return { message: "Sale successfully voided." };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private static async checkIdempotency(idempotencyKey: string) {
    return saleRepository.findByIdempotencyKey(idempotencyKey);
  }

  private static async fetchVariants(items: CheckoutInput["items"]) {
    const variantIds = items.map((i) => i.variantId);
    return productVariantRepository.findVariantsForCheckout(variantIds);
  }

  private static validateVariants(
    variants: Awaited<ReturnType<typeof productVariantRepository.findVariantsForCheckout>>,
    requestedItems: CheckoutInput["items"]
  ) {
    if (variants.length !== requestedItems.length) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "One or more variants in the cart do not exist.");
    }

    for (const item of requestedItems) {
      const dbVariant = variants.find((v) => v.id === item.variantId);
      if (!dbVariant) continue;

      if (!dbVariant.isActive) {
        throw new AppError(HTTP_STATUS.BAD_REQUEST, `Variant ${dbVariant.sku} is inactive and cannot be sold.`);
      }

      if (dbVariant.currentStock < item.quantity) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          `Insufficient stock for ${dbVariant.sku}. Requested: ${item.quantity}, Available: ${dbVariant.currentStock}`
        );
      }
    }
  }

  private static calculatePricing(
    variants: Awaited<ReturnType<typeof productVariantRepository.findVariantsForCheckout>>,
    items: CheckoutInput["items"],
    manualDiscount: number,
    employee: any,
    activePromotions: any[],
    taxRate: any,
    finalCustomerId: string
  ) {
    const pricingItems: PricingVariantItem[] = items.map((item) => {
      const dbVariant = variants.find((v) => v.id === item.variantId)!;
      return {
        variantId: item.variantId,
        quantity: item.quantity,
        dbSellingPrice: dbVariant.sellingPrice,
        dbCostPrice: dbVariant.costPrice,
        productId: dbVariant.product.id,
        categoryId: dbVariant.product.categoryId,
        brandId: dbVariant.product.brandId,
      };
    });

    // Baseline Subtotal for Promotion Evaluation
    const baseSubtotal = pricingItems.reduce(
      (sum, item) => sum + (Number(item.dbSellingPrice) * item.quantity), 
      0
    );

    const promotionContext: PromotionContext = {
      items: pricingItems,
      customerId: finalCustomerId,
      cartSubtotal: baseSubtotal,
      currentDate: new Date(),
    };

    const appliedPromotions = PromotionEngine.evaluate(promotionContext, activePromotions);

    return PricingEngine.calculateCheckout(pricingItems, manualDiscount, employee.role, appliedPromotions, taxRate);
  }

  private static async executeCheckoutTransaction(
    payload: CheckoutInput,
    variants: Awaited<ReturnType<typeof productVariantRepository.findVariantsForCheckout>>,
    employee: any,
    activePromotions: any[],
    taxRate: any,
    idempotencyKey: string
  ): Promise<string> {
    return prisma.$transaction(async (tx) => {
      // 0. Determine or Create Customer inside transaction
      let finalCustomerId: string;

      if (payload.customer?.id) {
        finalCustomerId = payload.customer.id;
      } else if (payload.customer?.phone && payload.customer?.name) {
        // Find existing or create new
        let existing = await tx.customer.findFirst({ where: { phone: payload.customer.phone } });
        if (existing) {
          finalCustomerId = existing.id;
        } else {
          // Generate customer code based on count
          const count = await tx.customer.count({
            where: { isWalkIn: false },
          });
          const customerCode = `CUS-${String(count + 1).padStart(6, "0")}`;

          const newCust = await tx.customer.create({
            data: {
              customerCode,
              name: payload.customer.name,
              phone: payload.customer.phone,
              isActive: true,
              isWalkIn: false,
            }
          });
          finalCustomerId = newCust.id;
        }
      } else {
        // Default to Walk-In
        const walkIn = await tx.customer.findFirst({ where: { isWalkIn: true } });
        if (!walkIn) throw new AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, "Walk-In customer not initialized.");
        finalCustomerId = walkIn.id;
      }

      // 1. Math Pipeline
      const pricing = this.calculatePricing(variants, payload.items, payload.manualDiscountAmount || 0, employee, activePromotions, taxRate, finalCustomerId);
      const payments = PaymentService.processPayments(payload.payments as any, pricing.grandTotal);

      // 2. Invoice Sequencing
      const invoiceNumber = await InvoiceService.generateNextInvoiceNumber(tx);

      // 3. Build DTOs (Mapping logic kept out of the main orchestrator body)
      const saleDTO = this.buildSaleDTO(payload, pricing, payments, employee.id, idempotencyKey, invoiceNumber, finalCustomerId);
      const createdSale = await saleRepository.createSale(tx, saleDTO);

      const itemsDTO = this.buildSaleItemsDTO(payload.items, variants, pricing, createdSale.id);
      await saleRepository.createSaleItems(tx, itemsDTO);

      const paymentsDTO = this.buildPaymentsDTO(payments, createdSale.id);
      if (paymentsDTO.length > 0) {
        await saleRepository.createPayments(tx, paymentsDTO);
      }

      // 4. Deduct Inventory (The `executeMovement` function verifies stock >= 0 internally again)
      await this.deductInventory(payload.items, createdSale.id, employee.id, tx);

      return createdSale.id;
    });
  }

  private static async deductInventory(
    items: CheckoutInput["items"],
    saleId: string,
    employeeId: string,
    tx: Prisma.TransactionClient
  ) {
    for (const item of items) {
      await executeMovement(
        {
          variantId: item.variantId,
          quantityChanged: -item.quantity,
          type: MovementType.SALE,
          relatedSaleId: saleId,
          employeeId,
        },
        tx
      );
    }
  }

  // ============================================================================
  // DTO BUILDERS
  // ============================================================================

  private static buildSaleDTO(
    payload: CheckoutInput,
    pricing: ReturnType<typeof PricingEngine.calculateCheckout>,
    payments: ReturnType<typeof PaymentService.processPayments>,
    employeeId: string,
    idempotencyKey: string,
    invoiceNumber: string,
    finalCustomerId: string
  ): Prisma.SaleUncheckedCreateInput {
    return {
      saleNumber: invoiceNumber,
      idempotencyKey,
      customerId: finalCustomerId,
      employeeId,
      subtotal: pricing.subtotal,
      discountAmount: pricing.discountAmount, // Automatic System Discounts
      manualDiscountAmount: pricing.manualDiscountAmount,
      manualDiscountReason: payload.manualDiscountReason || null,
      taxAmount: pricing.taxAmount,
      grandTotal: pricing.grandTotal,
      paidAmount: payments.totalPaid,
      dueAmount: payments.dueAmount,
      couponId: payload.couponId || null,
      notes: payload.notes || null,
      status: payments.saleStatus,
    };
  }

  private static buildSaleItemsDTO(
    items: CheckoutInput["items"],
    variants: Awaited<ReturnType<typeof productVariantRepository.findVariantsForCheckout>>,
    pricing: ReturnType<typeof PricingEngine.calculateCheckout>,
    saleId: string
  ): Prisma.SaleItemUncheckedCreateInput[] {
    return items.map((item) => {
      const dbVariant = variants.find((v) => v.id === item.variantId)!;
      const calcItem = pricing.calculatedItems.find((ci) => ci.variantId === item.variantId)!;

      return {
        saleId,
        variantId: item.variantId,
        productName: dbVariant.product.name,
        sizeName: dbVariant.size.name,
        colorName: dbVariant.color.name,
        sku: dbVariant.sku,
        barcode: dbVariant.barcode || null,
        quantity: item.quantity,
        sellingPrice: calcItem.sellingPrice,
        taxRate: calcItem.taxRate,
        taxAmount: calcItem.taxAmount,
        costAtSale: calcItem.costAtSale,
        totalPrice: calcItem.totalPrice,
      };
    });
  }

  private static buildPaymentsDTO(
    payments: ReturnType<typeof PaymentService.processPayments>,
    saleId: string
  ): Prisma.PaymentUncheckedCreateInput[] {
    return payments.processedPayments.map((p) => ({
      saleId,
      method: p.method,
      amount: p.amount,
      transactionRef: p.transactionRef,
      status: p.status,
    }));
  }

  private static buildCheckoutResponse(sale: any) {
    // Keeps raw Prisma payloads out of the controller
    return {
      id: sale.id,
      saleNumber: sale.saleNumber,
      status: sale.status,
      grandTotal: sale.grandTotal,
      paidAmount: sale.paidAmount,
      dueAmount: sale.dueAmount,
      saleDate: sale.saleDate,
      customer: sale.customer || null,
      items: sale.items,
      payments: sale.payments,
    };
  }

  private static async logCheckoutAudit(saleId: string, employeeId: string) {
    return auditRepository.create({
      performedBy: employeeId,
      action: "CREATE",
      module: ActionModule.SALE,
      tableName: "sales",
      recordId: saleId,
      newData: { event: "CHECKOUT_COMPLETED" },
    });
  }
}
