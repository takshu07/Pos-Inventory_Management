import { prisma } from './src/config/prisma';

async function main() {
  console.log("Seeding test products and inventory...");

  // 1. Get Employee
  const employee = await prisma.employee.findFirst();
  if (!employee) {
    throw new Error("No employee found. Cannot seed inventory without an employee.");
  }

  // 2. Create Category
  const category = await prisma.category.upsert({
    where: { name: 'Men Clothing' },
    update: {},
    create: {
      name: 'Men Clothing',
      description: 'Test category for men',
    },
  });

  // 3. Create Brand
  const brand = await prisma.brand.upsert({
    where: { name: 'Budhlakoti Basics' },
    update: {},
    create: {
      name: 'Budhlakoti Basics',
      description: 'In-house brand',
    },
  });

  // 4. Create Size
  const size = await prisma.size.upsert({
    where: { name: 'Large' },
    update: {},
    create: { name: 'Large', sortOrder: 3 },
  });

  // 5. Create Color
  const color = await prisma.color.upsert({
    where: { name: 'Black' },
    update: {},
    create: { name: 'Black', hexCode: '#000000' },
  });

  // 6. Create Product
  let product = await prisma.product.findFirst({ where: { name: 'Classic Black Polo' }});
  if (!product) {
    product = await prisma.product.create({
      data: {
        name: 'Classic Black Polo',
        description: 'A comfortable classic polo shirt.',
        categoryId: category.id,
        brandId: brand.id,
      },
    });
  }

  // 7. Create Variant
  let variant = await prisma.productVariant.findFirst({ where: { sku: 'POLO-BLK-L' }});
  if (!variant) {
    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sizeId: size.id,
        colorId: color.id,
        sku: 'POLO-BLK-L',
        barcode: '123456789012',
        costPrice: 400,
        sellingPrice: 799,
        mrp: 999,
        currentStock: 0, // We will update via movement
      },
    });

    // 8. Add initial inventory stock
    await prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.create({
        data: {
          variantId: variant!.id,
          type: 'OPENING_STOCK',
          quantityChanged: 50,
          stockBefore: 0,
          stockAfter: 50,
          reason: 'Initial test seed',
          employeeId: employee.id,
        }
      });

      await tx.productVariant.update({
        where: { id: variant!.id },
        data: { currentStock: 50 }
      });
    });
  }

  // 9. Second Variant (Out of stock test)
  let variant2 = await prisma.productVariant.findFirst({ where: { sku: 'POLO-BLK-M' }});
  if (!variant2) {
    const sizeM = await prisma.size.upsert({
      where: { name: 'Medium' },
      update: {},
      create: { name: 'Medium', sortOrder: 2 },
    });

    variant2 = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sizeId: sizeM.id,
        colorId: color.id,
        sku: 'POLO-BLK-M',
        barcode: '123456789013',
        costPrice: 400,
        sellingPrice: 799,
        mrp: 999,
        currentStock: 0, // Remains 0 to test out-of-stock
      },
    });
  }

  console.log("-----------------------------------------");
  console.log("✅ SEED SUCCESSFUL! Here is your test data:");
  console.log("-----------------------------------------");
  console.log(`EMPLOYEE LOGIN:`);
  console.log(`Phone: ${employee.phone}`);
  console.log(`Password: You must use the password you set up (e.g. Password123)`);
  console.log("");
  console.log("PRODUCT 1 (IN STOCK):");
  console.log(`Name: ${product.name} (Large)`);
  console.log(`SKU: ${variant.sku}`);
  console.log(`Barcode: ${variant.barcode}`);
  console.log(`Price: ₹799`);
  console.log("");
  console.log("PRODUCT 2 (OUT OF STOCK):");
  console.log(`Name: ${product.name} (Medium)`);
  console.log(`SKU: ${variant2.sku}`);
  console.log(`Barcode: ${variant2.barcode}`);
  console.log(`Price: ₹799`);
  console.log("-----------------------------------------");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
