import { prisma } from './src/config/prisma';

async function main() {
  console.log("Creating Walk-In Customer...");

  const existing = await prisma.customer.findFirst({ where: { isWalkIn: true } });
  if (existing) {
    console.log("Walk-in customer already exists:", existing.id);
    return;
  }

  const walkIn = await prisma.customer.create({
    data: {
      customerCode: 'WALK-IN',
      isWalkIn: true,
      name: 'Walk-In Customer',
      phone: '0000000000',
    },
  });

  console.log("✅ Walk-In Customer Created:", walkIn.id);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
