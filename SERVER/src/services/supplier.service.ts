// =============================================================================
// SUPPLIER SERVICE
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { supplierRepository } from "../repositories/supplier.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { PaginatedResponse } from "../types/common.types";
import { stripUndefined } from "../utils/object";
import { deriveSupplierBalances } from "../engines/procurement.engine";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "../validation/catalog.validation";

/**
 * Attaches procurement and settlement statistics to a page of suppliers.
 *
 * `outstanding` is summed from the bills' own `dueAmount` column rather than
 * recomputed as (spend − paid). The two agree for bill-linked payments, but a
 * supplier can also be paid ON ACCOUNT (a SupplierPayment with no purchaseId),
 * and treating that as settling specific bills would understate what is still
 * owed against them. The bills' own balance is the authoritative liability;
 * on-account credit is reported separately.
 */
async function withStats<T extends { id: string }>(suppliers: T[]) {
  const { purchases, payments, products } = await supplierRepository.statsFor(
    suppliers.map((s) => s.id)
  );

  const purchaseById = new Map(purchases.map((p) => [p.supplierId, p]));
  const paymentById = new Map(payments.map((p) => [p.supplierId, p]));
  const productById = new Map(
    products.filter((p) => p.supplierId).map((p) => [p.supplierId as string, p])
  );

  return suppliers.map((supplier) => {
    const p = purchaseById.get(supplier.id);
    const pay = paymentById.get(supplier.id);
    const prod = productById.get(supplier.id);

    // Balance derivation (including the on-account credit rule) lives in the
    // procurement engine so it is unit-testable.
    const balances = deriveSupplierBalances({
      purchaseCount: p?._count._all ?? 0,
      totalSpend: p?._sum.totalAmount ?? 0,
      paidOnBills: p?._sum.paidAmount ?? 0,
      outstanding: p?._sum.dueAmount ?? 0,
      totalPaid: pay?._sum.amount ?? 0,
      paymentCount: pay?._count._all ?? 0,
    });

    return {
      ...supplier,
      stats: {
        ...balances,
        lastPurchaseDate: p?._max.purchaseDate ?? null,
        lastPaymentDate: pay?._max.paidAt ?? null,
        suppliedVariantCount: prod?._count._all ?? 0,
      },
    };
  });
}

export async function listSuppliers(query: ListSuppliersQuery) {
  const { data, total } = await supplierRepository.findMany(query);
  const totalPages = Math.ceil(total / query.limit);
  const enriched = await withStats(data);

  const response: PaginatedResponse<(typeof enriched)[0]> = {
    data: enriched,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };

  return response;
}

/**
 * Full supplier profile: the record, its rollups, and the three histories the
 * profile screen shows as tabs. Fetched together because the profile always
 * renders all of them, so splitting into four round trips to a network-latency
 * database would be slower for no benefit.
 */
export async function getSupplierById(id: string) {
  const supplier = await supplierRepository.findById(id);

  if (!supplier) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");
  }

  const [[enriched], purchases, payments, products] = await Promise.all([
    withStats([supplier]),
    supplierRepository.purchaseHistory(id),
    supplierRepository.paymentHistory(id),
    supplierRepository.suppliedProducts(id),
  ]);

  return { ...enriched, purchases, payments, products };
}

export async function createSupplier(data: CreateSupplierInput, executorId: string) {
  const existing = await supplierRepository.findByPhone(data.phone);

  if (existing) {
    throw new AppError(HTTP_STATUS.CONFLICT, "A supplier with this phone number already exists.");
  }

  const supplier = await supplierRepository.create({
    businessName: data.businessName,
    contactPerson: data.contactPerson ?? null,
    phone: data.phone,
    email: data.email ?? null,
    address: data.address ?? null,
    notes: data.notes ?? null,
  });

  auditRepository.create({
    performedBy: executorId,
    action: "CREATE",
    module: "SUPPLIER",
    tableName: "suppliers",
    recordId: supplier.id,
    newData: supplier as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, supplierId: supplier.id }, "Supplier created");

  return supplier;
}

export async function updateSupplier(
  id: string,
  data: UpdateSupplierInput,
  executorId: string
) {
  const targetSupplier = await supplierRepository.findById(id);

  if (!targetSupplier) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");
  }

  if (data.phone) {
    const existing = await supplierRepository.findByPhone(data.phone, id);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "Another supplier with this phone number already exists.");
    }
  }

  const updateData = stripUndefined(data);
  const updatedSupplier = await supplierRepository.update(id, updateData as any);

  auditRepository.create({
    performedBy: executorId,
    action: "UPDATE",
    module: "SUPPLIER",
    tableName: "suppliers",
    recordId: id,
    oldData: targetSupplier as unknown as Record<string, unknown>,
    newData: updatedSupplier as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, supplierId: id }, "Supplier updated");

  return updatedSupplier;
}

/**
 * Deletes a supplier outright.
 *
 * Permitted only when nothing references them. A supplier with purchases,
 * payments or supplied variants carries financial history that must survive —
 * deactivating removes them from pickers while keeping every bill and payment
 * intact and reportable.
 */
export async function deleteSupplier(id: string, executorId: string) {
  const supplier = await supplierRepository.findById(id);

  if (!supplier) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");
  }

  const refs = await supplierRepository.referenceCounts(id);
  const blocking = refs.purchases + refs.variants + refs.payments;

  if (blocking > 0) {
    const parts: string[] = [];
    if (refs.purchases) parts.push(`${refs.purchases} purchase(s)`);
    if (refs.payments) parts.push(`${refs.payments} payment(s)`);
    if (refs.variants) parts.push(`${refs.variants} supplied product(s)`);

    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `${supplier.businessName} still has ${parts.join(", ")}. Deactivate the supplier instead of deleting.`,
      { reason: "SUPPLIER_IN_USE", ...refs }
    );
  }

  await supplierRepository.remove(id);

  auditRepository.create({
    performedBy: executorId,
    action: "DELETE",
    module: "SUPPLIER",
    tableName: "suppliers",
    recordId: id,
    oldData: supplier as unknown as Record<string, unknown>,
  });

  logger.info({ executorId, supplierId: id }, "Supplier deleted");

  return { id };
}
