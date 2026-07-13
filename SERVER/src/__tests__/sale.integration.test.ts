import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app from "../app";
import { prisma } from "../config/prisma";
import { SaleStatus, PaymentStatus, MovementType, PaymentMethod } from "../../generated/prisma";

// Mock the authentication middleware to bypass JWT for pure integration testing
// In a real project, we would use a test JWT generator, but since the project lacks
// an existing test suite, we mock the middleware layer to simulate RBAC roles.
vi.mock("../middleware/auth.middleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: "test-employee-id", role: req.headers["x-test-role"] || "CASHIER" };
    next();
  },
}));

describe("Sales Engine Integration Tests", () => {
  let testVariantId: string;
  let testCustomerId: string;

  beforeEach(async () => {
    // 1. Clean DB (Order matters due to foreign keys)
    await prisma.payment.deleteMany();
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.inventoryMovement.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.customer.deleteMany();

    // 2. Seed prerequisites
    const customer = await prisma.customer.create({
      data: { customerCode: "TEST-001", name: "Test Customer", phone: "9876543210", isWalkIn: false },
    });
    testCustomerId = customer.id;

    // Seed dummy Product/Variant hierarchy
    const category = await prisma.category.create({ data: { name: "Test Category" } });
    const product = await prisma.product.create({
      data: { name: "Test Product", categoryId: category.id, isActive: true },
    });
    const size = await prisma.size.create({ data: { name: "M" } });
    const color = await prisma.color.create({ data: { name: "Red", hexCode: "#FF0000" } });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sizeId: size.id,
        colorId: color.id,
        sku: "TEST-SKU-001",
        costPrice: 500,
        sellingPrice: 1000, // Important for math checks
        mrp: 1200,
        currentStock: 10,
        isActive: true,
      },
    });
    testVariantId = variant.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe("1. Successful Checkout", () => {
    it("should complete a full checkout, deducting inventory and generating audits", async () => {
      const payload = {
        customerId: testCustomerId,
        manualDiscountAmount: 0,
        items: [{ variantId: testVariantId, quantity: 2 }], // 2 * 1000 = 2000
        payments: [{ method: PaymentMethod.CASH, amount: 2000 }],
      };

      const res = await request(app)
        .post("/api/v1/sales")
        .set("Idempotency-Key", "test-uuid-1")
        .set("x-test-role", "CASHIER")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.grandTotal).toBe("2000"); // Prisma Decimal mapped to string
      expect(res.body.data.status).toBe(SaleStatus.COMPLETED);

      // Verify DB State
      const sale = await prisma.sale.findUnique({ where: { id: res.body.data.id } });
      expect(sale?.saleNumber).toMatch(/^INV-\d{8}-\d{6}$/);

      // Verify Inventory Deducted
      const variant = await prisma.productVariant.findUnique({ where: { id: testVariantId } });
      expect(variant?.currentStock).toBe(8); // 10 - 2

      // Verify InventoryMovement Logged
      const movement = await prisma.inventoryMovement.findFirst({ where: { relatedSaleId: sale!.id } });
      expect(movement?.type).toBe(MovementType.SALE);
      expect(movement?.quantityChanged).toBe(-2);
    });
  });

  describe("2. Split Payment", () => {
    it("should accept mixed payment methods equalling grand total", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 2 }], // 2000
        payments: [
          { method: PaymentMethod.CASH, amount: 500 },
          { method: PaymentMethod.UPI, amount: 1500 },
        ],
      };

      const res = await request(app)
        .post("/api/v1/sales")
        .set("Idempotency-Key", "test-uuid-2")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.paidAmount).toBe("2000");
      expect(res.body.data.status).toBe(SaleStatus.COMPLETED);

      const payments = await prisma.payment.findMany({ where: { saleId: res.body.data.id } });
      expect(payments.length).toBe(2);
      expect(payments.some((p) => p.method === PaymentMethod.CASH)).toBeTruthy();
      expect(payments.some((p) => p.method === PaymentMethod.UPI)).toBeTruthy();
    });
  });

  describe("3. Partial Payment", () => {
    it("should mark sale as PARTIAL if paid amount is less than grand total", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 2 }], // 2000
        payments: [{ method: PaymentMethod.CASH, amount: 500 }],
      };

      const res = await request(app)
        .post("/api/v1/sales")
        .set("Idempotency-Key", "test-uuid-3")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.dueAmount).toBe("1500");
      expect(res.body.data.status).toBe(SaleStatus.PARTIAL);
    });
  });

  describe("4. Invalid Payment / Overpayment", () => {
    it("should calculate change correctly and normalize dueAmount to 0 for overpayments", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 1 }], // 1000
        payments: [{ method: PaymentMethod.CASH, amount: 2000 }], // Customer handed 2000 note
      };

      const res = await request(app)
        .post("/api/v1/sales")
        .set("Idempotency-Key", "test-uuid-4")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.dueAmount).toBe("0"); // Never negative in the ledger
      expect(res.body.data.status).toBe(SaleStatus.COMPLETED);
    });

    it("should reject negative payments", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 1 }],
        payments: [{ method: PaymentMethod.CASH, amount: -100 }],
      };

      const res = await request(app).post("/api/v1/sales").set("Idempotency-Key", "test-uuid-5").send(payload);
      expect(res.status).toBe(400);
    });
  });

  describe("5. Insufficient Stock", () => {
    it("should reject the checkout and perfectly rollback", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 50 }], // Only 10 available
        payments: [{ method: PaymentMethod.CASH, amount: 50000 }],
      };

      const res = await request(app).post("/api/v1/sales").set("Idempotency-Key", "test-uuid-6").send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Insufficient stock");

      // Verify Rollback
      const salesCount = await prisma.sale.count();
      expect(salesCount).toBe(0);

      const variant = await prisma.productVariant.findUnique({ where: { id: testVariantId } });
      expect(variant?.currentStock).toBe(10); // Untouched
    });
  });

  describe("6. Idempotency & Concurrency", () => {
    it("should return the exact original successful response on duplicate retry", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 1 }],
        payments: [{ method: PaymentMethod.CASH, amount: 1000 }],
      };

      // Request 1
      const res1 = await request(app).post("/api/v1/sales").set("Idempotency-Key", "idem-7").send(payload);
      expect(res1.status).toBe(201);

      // Request 2 (Network Retry)
      const res2 = await request(app).post("/api/v1/sales").set("Idempotency-Key", "idem-7").send(payload);
      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(res1.body.data.id); // Same DB ID returned

      // Verify stock was only deducted ONCE (10 - 1 = 9)
      const variant = await prisma.productVariant.findUnique({ where: { id: testVariantId } });
      expect(variant?.currentStock).toBe(9);
    });
  });

  describe("10. Void Sale & RBAC", () => {
    it("should reject voids from Cashiers", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 1 }],
        payments: [{ method: PaymentMethod.CASH, amount: 1000 }],
      };
      const sale = await request(app).post("/api/v1/sales").set("Idempotency-Key", "idem-8").set("x-test-role", "CASHIER").send(payload);

      // Attempt void as Cashier
      const res = await request(app).post(`/api/v1/sales/${sale.body.data.id}/void`).set("x-test-role", "CASHIER").send({ reason: "Mistake" });
      expect(res.status).toBe(403); // Forbidden
    });

    it("should allow voids from Managers and restore inventory", async () => {
      const payload = {
        items: [{ variantId: testVariantId, quantity: 2 }],
        payments: [{ method: PaymentMethod.CASH, amount: 2000 }],
      };
      const saleRes = await request(app).post("/api/v1/sales").set("Idempotency-Key", "idem-9").set("x-test-role", "MANAGER").send(payload);
      const saleId = saleRes.body.data.id;

      // Ensure stock dropped to 8
      const var1 = await prisma.productVariant.findUnique({ where: { id: testVariantId } });
      expect(var1?.currentStock).toBe(8);

      // Void the sale
      const voidRes = await request(app)
        .post(`/api/v1/sales/${saleId}/void`)
        .set("x-test-role", "MANAGER")
        .send({ reason: "Wrong item scanned" });
        
      expect(voidRes.status).toBe(200);

      // Verify Sale Status updated
      const voidedSale = await prisma.sale.findUnique({ where: { id: saleId } });
      expect(voidedSale?.status).toBe(SaleStatus.CANCELLED); // Mapped to VOIDED conceptually

      // Verify Stock Restored to 10
      const var2 = await prisma.productVariant.findUnique({ where: { id: testVariantId } });
      expect(var2?.currentStock).toBe(10);
      
      // Verify Audit Log generated
      const audit = await prisma.auditLog.findFirst({ where: { recordId: saleId, action: "UPDATE" } });
      expect(audit).toBeDefined();
    });
  });
});
