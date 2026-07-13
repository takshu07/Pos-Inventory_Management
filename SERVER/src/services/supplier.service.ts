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
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "../validation/catalog.validation";

export async function listSuppliers(query: ListSuppliersQuery) {
  const { data, total } = await supplierRepository.findMany(query);
  const totalPages = Math.ceil(total / query.limit);

  const response: PaginatedResponse<(typeof data)[0]> = {
    data,
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

export async function getSupplierById(id: string) {
  const supplier = await supplierRepository.findById(id);

  if (!supplier) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Supplier not found.");
  }

  return supplier;
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
