import { Prisma } from "../../generated/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { logger } from "../config/logger";
import { customerRepository } from "../repositories/customer.repository";
import { auditRepository } from "../repositories/audit.repository";
import { stripUndefined } from "../utils/object";
import type { PaginationParams, PaginatedResponse } from "../types/common.types";
import { formatPaginatedResponse } from "../utils/queryEngine";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { evaluateExchangeWindow } from "../utils/exchangeWindow";
import { prisma } from "../config/prisma";

/**
 * Normalizes a phone number by stripping country codes and non-digit characters.
 * Example: "+91 9876543210" -> "9876543210"
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.length > 10 && cleaned.startsWith("91")) {
    cleaned = cleaned.substring(2);
  }
  return cleaned;
}

export const customerService = {
  /**
   * Retrieves a paginated list of customers.
   */
  async getCustomers(params: PaginationParams) {
    const [total, data] = await customerRepository.findAll(params);
    return formatPaginatedResponse(data, total, params);
  },

  /**
   * Retrieves a single customer with their calculated statistics.
   */
  async getCustomerById(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    const stats = await customerRepository.getStatistics(id);

    return { ...customer, statistics: stats };
  },

  /**
   * Retrieves a single customer by phone exactly.
   */
  async getCustomerByPhone(phone: string) {
    const normalizedPhone = normalizePhone(phone);
    const customer = await customerRepository.findByPhone(normalizedPhone);
    
    if (!customer) {
      return null;
    }

    const stats = await customerRepository.getStatistics(customer.id);
    return { ...customer, statistics: stats };
  },

  /**
   * Retrieves the Walk-In Customer.
   */
  async getWalkInCustomer() {
    return customerRepository.getWalkInCustomer();
  },

  /**
   * Creates a new customer.
   */
  async createCustomer(data: any, executorId: string) {
    const normalizedPhone = normalizePhone(data.phone);

    // 1. Uniqueness check
    const existing = await customerRepository.findByPhone(normalizedPhone);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "A customer with this phone number already exists.");
    }

    // 2. Generate Customer Code
    const nextSeq = await customerRepository.getNextSequenceNumber();
    const customerCode = `CUS-${String(nextSeq).padStart(6, "0")}`;

    // 3. Prepare payload
    const payload: Prisma.CustomerCreateInput = {
      customerCode,
      name: data.name,
      phone: normalizedPhone,
      email: data.email,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth,
      anniversary: data.anniversary,
      notes: data.notes,
      isActive: true,
      isWalkIn: false,
    };

    if (data.addresses && data.addresses.length > 0) {
      payload.addresses = {
        create: data.addresses,
      };
    }

    // 4. Create in DB
    const newCustomer = await customerRepository.create(payload);

    // 5. Audit Logging
    auditRepository.create({
      performedBy: executorId,
      action: "CREATE",
      module: "CUSTOMER",
      tableName: "customers",
      recordId: newCustomer.id,
      oldData: null,
      newData: newCustomer,
    }).catch((err) => logger.error({ err, id: newCustomer.id }, "Failed to write audit log for customer creation"));

    logger.info({ customerId: newCustomer.id, executorId }, "Customer created");

    return newCustomer;
  },

  /**
   * Updates an existing customer.
   */
  async updateCustomer(id: string, data: any, executorId: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    if (customer.isWalkIn) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "The permanent Walk-In customer cannot be modified.");
    }

    const updates: Prisma.CustomerUpdateInput = stripUndefined({
      name: data.name,
      email: data.email,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth,
      anniversary: data.anniversary,
      notes: data.notes,
      isActive: data.isActive,
    });

    if (data.phone) {
      const normalizedPhone = normalizePhone(data.phone);
      if (normalizedPhone !== customer.phone) {
        const existing = await customerRepository.findByPhone(normalizedPhone);
        if (existing) {
          throw new AppError(HTTP_STATUS.CONFLICT, "This phone number is already registered to another customer.");
        }
        updates.phone = normalizedPhone;
      }
    }

    let newAddresses: Prisma.CustomerAddressCreateManyCustomerInput[] | undefined;
    if (data.addresses) {
      newAddresses = data.addresses;
    }

    const updatedCustomer = await customerRepository.update(id, updates, newAddresses);

    // Audit Logging
    auditRepository.create({
      performedBy: executorId,
      action: "UPDATE",
      module: "CUSTOMER",
      tableName: "customers",
      recordId: id,
      oldData: customer,
      newData: updatedCustomer,
    }).catch((err) => logger.error({ err, id }, "Failed to write audit log for customer update"));

    logger.info({ customerId: id, executorId }, "Customer updated");

    return updatedCustomer;
  },

  /**
   * Retrieves the purchase history for a customer.
   */
  async getCustomerPurchaseHistory(id: string, params: PaginationParams) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    // We can rely on the Query Engine from Sale repository in a full integration,
    // but here we can write a dedicated repository function if needed.
    // Assuming saleRepository.findAll accepts baseFilters.
    // For this module, we will just delegate to Prisma directly to keep the service self-contained for the deliverable.
    
    // Instead of duplicating query engine, we will import buildPrismaQuery here
    const { buildPrismaQuery, formatPaginatedResponse } = await import("../utils/queryEngine");
    const { prisma } = await import("../config/prisma");

    const queryArgs = buildPrismaQuery(
      {
        searchableFields: ["saleNumber"],
        allowedSortFields: ["saleDate", "grandTotal"],
        allowedFilters: ["status"],
        defaultSort: { field: "saleDate", order: "desc" },
        baseFilters: { customerId: id },
      },
      params
    );

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where: queryArgs.where }),
      prisma.sale.findMany({
        ...queryArgs,
        include: { items: true, payments: true },
      }),
    ]);

    return formatPaginatedResponse(data, total, params);
  },

  /**
   * Computes exchange eligibility for a customer's recent sales.
   *
   * A sale is eligible when it is still exchangeable (COMPLETED or PARTIAL) and
   * its age has not exceeded the configured exchange window. The window is read
   * from the ConfigurationEngine so the cashier UI reflects the same rule the
   * exchange flow enforces.
   */
  async getExchangeEligibility(id: string, limit = 10) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    const sales = await prisma.sale.findMany({
      where: {
        customerId: id,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
      orderBy: { saleDate: "desc" },
      take: limit,
      select: {
        id: true,
        saleNumber: true,
        saleDate: true,
        grandTotal: true,
        status: true,
      },
    });

    // Same evaluateExchangeWindow helper the exchange enforcement uses, so the
    // eligibility shown here always matches what processExchange will accept.
    const now = new Date();
    const windowDays = ConfigurationEngine.getExchangeSettings().exchangeWindowDays;

    const items = sales.map((sale) => {
      const status = evaluateExchangeWindow(sale.saleDate, now);
      return {
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        saleDate: sale.saleDate,
        grandTotal: sale.grandTotal,
        eligible: status.eligible,
        daysRemaining: status.daysRemaining,
        elapsedDays: status.elapsedDays,
        expiresOn: status.expiresOn,
      };
    });

    return {
      windowDays,
      items,
    };
  },
};
