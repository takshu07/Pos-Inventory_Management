import { prisma } from './src/config/prisma';

async function getStatistics(customerId: string) {
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
}

async function test() {
  const customer = await prisma.customer.findUnique({ where: { phone: "9412944335" } });
  if (customer) {
    console.log("Customer:", customer.name);
    const stats = await getStatistics(customer.id);
    console.log("Stats:", stats);
  }
}

test().catch(console.error).finally(() => prisma.$disconnect());
