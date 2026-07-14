import { prisma } from './src/config/prisma';

async function main() {
  console.log("Fetching test data...");

  const employees = await prisma.employee.findMany({ take: 1 });
  if (employees.length === 0) {
    console.log("No employees found. Run setup script.");
  } else {
    console.log("Employee found:");
    console.log(`Phone: ${employees[0].phone}`);
    console.log(`Role: ${employees[0].role}`);
    console.log("(Note: Use the password you set for this employee, usually 'Password123' if seeded)");
  }

  const variants = await prisma.productVariant.findMany({
    include: { product: true },
    take: 5
  });

  if (variants.length === 0) {
    console.log("\nNo product variants found in the database. You need to seed data.");
  } else {
    console.log("\n--- TEST BARCODES & SKUs ---");
    variants.forEach(v => {
      console.log(`Product: ${v.product.name} (ID: ${v.id})`);
      console.log(`SKU: ${v.sku}`);
      console.log(`Barcode: ${v.barcode || 'N/A'}`);
      console.log(`Stock: ${v.currentStock}`);
      console.log(`Price: ₹${v.sellingPrice}`);
      console.log("----------------------------");
    });
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
