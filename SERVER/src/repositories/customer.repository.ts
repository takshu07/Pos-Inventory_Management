import { prisma } from "../config/prisma";
import { Prisma } from "../../generated/prisma";
import { buildPrismaQuery } from "../utils/queryEngine";
import type { PaginationParams } from "../types/common.types";

export const customerRepository = {
  /**
   * Retrieves a paginated list of customers using the Enterprise Query Engine.
   */
  async findAll(params: PaginationParams) {
    const queryArgs = buildPrismaQuery<Prisma.CustomerWhereInput>(
      {
        searchableFields: ["name", "phone", "email", "customerCode"],
        allowedSortFields: ["createdAt", "name", "rewardPoints", "customerCode"],
        allowedFilters: ["isActive", "isWalkIn", "gender"],
        defaultSort: { field: "createdAt", order: "desc" },
      },
      params
    );

    return prisma.$transaction([
      prisma.customer.count({ where: queryArgs.where }),
      prisma.customer.findMany({
        ...queryArgs,
        include: { addresses: true },
      }),
    ]);
  },

  /**
   * Finds a customer by ID.
   */
  async findById(id: string) {
    return prisma.customer.findUnique({
      where: { id },
      include: { addresses: true },
    });
  },

  /**
   * Finds a customer by Phone.
   */
  async findByPhone(phone: string) {
    return prisma.customer.findUnique({
      where: { phone },
      include: { addresses: true },
    });
  },

  /**
   * Finds a customer by Code.
   */
  async findByCode(customerCode: string) {
    return prisma.customer.findUnique({
      where: { customerCode },
    });
  },

  /**
   * Finds or Creates the Walk-In Customer.
   * Uses raw SQL-like strict fallback since it's a critical system record.
   */
  async getWalkInCustomer() {
    let walkIn = await prisma.customer.findFirst({
      where: { isWalkIn: true },
    });

    if (!walkIn) {
      walkIn = await prisma.customer.create({
        data: {
          customerCode: "WALK-IN",
          name: "Walk-in Customer",
          phone: "0000000000",
          isWalkIn: true,
          isActive: true,
        },
      });
    }

    return walkIn;
  },

  /**
   * Creates a new customer.
   */
  async create(data: Prisma.CustomerCreateInput) {
    return prisma.customer.create({
      data,
      include: { addresses: true },
    });
  },

  /**
   * Updates an existing customer and fully replaces their addresses if provided.
   */
  async update(id: string, data: Prisma.CustomerUpdateInput, newAddresses?: Prisma.CustomerAddressCreateManyCustomerInput[]) {
    if (newAddresses) {
      return prisma.$transaction(async (tx) => {
        // Full replacement strategy for addresses
        await tx.customerAddress.deleteMany({ where: { customerId: id } });
        return tx.customer.update({
          where: { id },
          data: {
            ...data,
            addresses: {
              createMany: { data: newAddresses },
            },
          },
          include: { addresses: true },
        });
      });
    }

    return prisma.customer.update({
      where: { id },
      data,
      include: { addresses: true },
    });
  },

  /**
   * Retrieves the count of customers to generate sequential codes.
   */
  async getNextSequenceNumber(): Promise<number> {
    const lastCustomer = await prisma.customer.findFirst({
      where: { isWalkIn: false, customerCode: { startsWith: 'CUS-' } },
      orderBy: { customerCode: 'desc' },
    });

    if (!lastCustomer) return 1;

    const lastSeqStr = lastCustomer.customerCode.replace('CUS-', '');
    const parsedSeq = parseInt(lastSeqStr, 10);
    
    if (isNaN(parsedSeq)) return 1;
    return parsedSeq + 1;
  },

  /**
   * Retrieves aggregate statistics for a customer (e.g. lifetime spend).
   * This handles the complex aggregations directly via Prisma.
   */
  async getStatistics(customerId: string) {
    const aggregations = await prisma.sale.aggregate({
      where: { customerId, status: "COMPLETED" },
      _sum: { grandTotal: true },
      _count: { id: true },
      _min: { saleDate: true },
      _max: { saleDate: true },
    });

    const itemsPurchased = await prisma.saleItem.aggregate({
      where: { sale: { customerId, status: "COMPLETED" } },
      _sum: { quantity: true },
    });

    return {
      lifetimeSpend: aggregations._sum.grandTotal || 0,
      totalOrders: aggregations._count.id || 0,
      averageOrderValue:
        aggregations._count.id > 0
          ? Number(aggregations._sum.grandTotal || 0) / aggregations._count.id
          : 0,
      firstVisit: aggregations._min.saleDate,
      lastVisit: aggregations._max.saleDate,
      totalItemsPurchased: itemsPurchased._sum.quantity || 0,
    };
  },
};
