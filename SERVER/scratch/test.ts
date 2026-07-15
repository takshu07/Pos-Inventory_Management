import { PrismaClient } from '../generated/prisma';
const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany();
  console.log('All Customers:', customers.map(c => ({ id: c.id, phone: c.phone, name: c.name })));
  
  const sales = await prisma.sale.findMany();
  console.log('All Sales:', sales.map(s => ({ id: s.id, status: s.status, customerId: s.customerId })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
