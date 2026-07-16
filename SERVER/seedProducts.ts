import "dotenv/config";
import { prisma } from './src/config/prisma';

// Ensure it's not run in production
if (process.env.NODE_ENV === 'production') {
  console.error("CRITICAL: Do NOT run development seed in production!");
  process.exit(1);
}

async function main() {
  console.log("Seeding test products, customers, and sales for POS testing...");

  // 1. Get Employee
  const employee = await prisma.employee.findFirst();
  if (!employee) {
    throw new Error("No employee found. Cannot seed inventory without an employee.");
  }

  // 2. Setup Base Categories, Brands, Sizes, Colors
  const categories = {
    Polo: await prisma.category.upsert({ where: { name: 'Polo Shirts' }, update: {}, create: { name: 'Polo Shirts' } }),
    TShirt: await prisma.category.upsert({ where: { name: 'T-Shirts' }, update: {}, create: { name: 'T-Shirts' } }),
    Jeans: await prisma.category.upsert({ where: { name: 'Jeans' }, update: {}, create: { name: 'Jeans' } }),
    Trousers: await prisma.category.upsert({ where: { name: 'Trousers' }, update: {}, create: { name: 'Trousers' } }),
    Lowers: await prisma.category.upsert({ where: { name: 'Lowers' }, update: {}, create: { name: 'Lowers' } }),
    Jacket: await prisma.category.upsert({ where: { name: 'Jackets' }, update: {}, create: { name: 'Jackets' } }),
    Hoodie: await prisma.category.upsert({ where: { name: 'Hoodies' }, update: {}, create: { name: 'Hoodies' } }),
  };

  const brand = await prisma.brand.upsert({ where: { name: 'Budhlakoti Basics' }, update: {}, create: { name: 'Budhlakoti Basics' } });

  const sizes = {
    S: await prisma.size.upsert({ where: { name: 'Small' }, update: {}, create: { name: 'Small', sortOrder: 1 } }),
    M: await prisma.size.upsert({ where: { name: 'Medium' }, update: {}, create: { name: 'Medium', sortOrder: 2 } }),
    L: await prisma.size.upsert({ where: { name: 'Large' }, update: {}, create: { name: 'Large', sortOrder: 3 } }),
    XL: await prisma.size.upsert({ where: { name: 'XL' }, update: {}, create: { name: 'XL', sortOrder: 4 } }),
    '32': await prisma.size.upsert({ where: { name: '32' }, update: {}, create: { name: '32', sortOrder: 5 } }),
    '34': await prisma.size.upsert({ where: { name: '34' }, update: {}, create: { name: '34', sortOrder: 6 } }),
  };

  const colors = {
    Black: await prisma.color.upsert({ where: { name: 'Black' }, update: {}, create: { name: 'Black', hexCode: '#000000' } }),
    Blue: await prisma.color.upsert({ where: { name: 'Blue' }, update: {}, create: { name: 'Blue', hexCode: '#0000FF' } }),
    Navy: await prisma.color.upsert({ where: { name: 'Navy' }, update: {}, create: { name: 'Navy', hexCode: '#000080' } }),
    White: await prisma.color.upsert({ where: { name: 'White' }, update: {}, create: { name: 'White', hexCode: '#FFFFFF' } }),
    Khaki: await prisma.color.upsert({ where: { name: 'Khaki' }, update: {}, create: { name: 'Khaki', hexCode: '#F0E68C' } }),
    Grey: await prisma.color.upsert({ where: { name: 'Grey' }, update: {}, create: { name: 'Grey', hexCode: '#808080' } }),
    Red: await prisma.color.upsert({ where: { name: 'Red' }, update: {}, create: { name: 'Red', hexCode: '#FF0000' } }),
  };

  // 3. Setup Customers
  const customers = {
    Kamal: await prisma.customer.upsert({ where: { phone: '9412944335' }, update: {}, create: { name: 'Kamal', phone: '9412944335', customerCode: 'CUST-001' } }),
    Rohit: await prisma.customer.upsert({ where: { phone: '9876543210' }, update: {}, create: { name: 'Rohit', phone: '9876543210', customerCode: 'CUST-002' } }),
    Ankit: await prisma.customer.upsert({ where: { phone: '9898989898' }, update: {}, create: { name: 'Ankit', phone: '9898989898', customerCode: 'CUST-003' } }),
  };

  // 4. Setup Products & Variants
  const variantsData = [
    { sku: 'POLO-BLK-L', barcode: '890100000001', name: 'Classic Black Polo', cat: categories.Polo, size: sizes.L, color: colors.Black, mrp: 799, stock: 18 },
    { sku: 'POLO-PREM-L', barcode: '890100000002', name: 'Premium Polo', cat: categories.Polo, size: sizes.L, color: colors.Black, mrp: 999, stock: 10 },
    { sku: 'TSHIRT-WHT-M', barcode: '890100000003', name: 'Basic T-Shirt', cat: categories.TShirt, size: sizes.M, color: colors.White, mrp: 599, stock: 20 },
    { sku: 'JEANS-BLU-32', barcode: '890100000004', name: 'Blue Jeans', cat: categories.Jeans, size: sizes['32'], color: colors.Blue, mrp: 1299, stock: 12 },
    { sku: 'TRS-KHK-34', barcode: '890100000005', name: 'Khaki Trousers', cat: categories.Trousers, size: sizes['34'], color: colors.Khaki, mrp: 1499, stock: 15 },
    { sku: 'LWR-GRY-M', barcode: '890100000006', name: 'Grey Lowers', cat: categories.Lowers, size: sizes.M, color: colors.Grey, mrp: 699, stock: 20 },
    { sku: 'JKT-BLK-XL', barcode: '890100000007', name: 'Winter Jacket', cat: categories.Jacket, size: sizes.XL, color: colors.Black, mrp: 2999, stock: 9 },
    { sku: 'HOODIE-NVY-M', barcode: '890100000008', name: 'Navy Hoodie', cat: categories.Hoodie, size: sizes.M, color: colors.Navy, mrp: 1999, stock: 12 },
    { sku: 'POLO-RED-L', barcode: '890100000009', name: 'Red Polo', cat: categories.Polo, size: sizes.L, color: colors.Red, mrp: 799, stock: 10 },
  ];

  const createdVariants: Record<string, any> = {};

  for (const v of variantsData) {
    let product = await prisma.product.findFirst({ where: { name: v.name } });
    if (!product) {
      product = await prisma.product.create({
        data: { name: v.name, description: `${v.name} description`, categoryId: v.cat.id, brandId: brand.id }
      });
    }

    let variant = await prisma.productVariant.upsert({
      where: { sku: v.sku },
      update: {
        barcode: v.barcode,
        costPrice: Math.floor(v.mrp * 0.5),
        sellingPrice: v.mrp,
        mrp: v.mrp,
      },
      create: {
        productId: product.id, sizeId: v.size.id, colorId: v.color.id,
        sku: v.sku, barcode: v.barcode, costPrice: Math.floor(v.mrp * 0.5), sellingPrice: v.mrp, mrp: v.mrp, currentStock: v.stock
      }
    });

    if (variant.currentStock < v.stock) {
      // Add Stock
      await prisma.$transaction(async (tx: any) => {
        await tx.inventoryMovement.create({
          data: { variantId: variant!.id, type: 'OPENING_STOCK', quantityChanged: v.stock - variant.currentStock, stockBefore: variant.currentStock, stockAfter: v.stock, reason: 'Test seed', employeeId: employee.id }
        });
        await tx.productVariant.update({ where: { id: variant!.id }, data: { currentStock: v.stock } });
      });
    }
    createdVariants[v.barcode] = variant;
  }

  // 5. Setup Historical Sales
  const generateSale = async (invoiceId: string, customerId: string, variant: any, daysAgo: number, productName: string, sizeName: string, colorName: string) => {
    const saleDate = new Date();
    saleDate.setDate(saleDate.getDate() - daysAgo);

    const existingSale = await prisma.sale.findUnique({ where: { saleNumber: invoiceId }, include: { items: true } });
    if (!existingSale) {
      const sale = await prisma.sale.create({
        data: {
          saleNumber: invoiceId,
          customerId,
          employeeId: employee.id,
          subtotal: variant.sellingPrice,
          taxAmount: 0,
          discountAmount: 0,
          grandTotal: variant.sellingPrice,
          status: 'COMPLETED',
          createdAt: saleDate,
          updatedAt: saleDate,
          saleDate: saleDate,
          items: {
            create: {
              variantId: variant.id,
              productName,
              sizeName,
              colorName,
              sku: variant.sku,
              barcode: variant.barcode,
              quantity: 1,
              costAtSale: variant.costPrice,
              sellingPrice: variant.sellingPrice,
              totalPrice: variant.sellingPrice
            }
          },
          payments: {
            create: {
              method: 'CASH',
              amount: variant.sellingPrice,
              createdAt: saleDate,
              updatedAt: saleDate
            }
          }
        },
        include: { items: true }
      });
      console.log(`Created Sale: ${invoiceId} for ${daysAgo} days ago`);
      return sale;
    }
    return existingSale;
  };

  // Scenario 1: Kamal bought Classic Black Polo yesterday (Eligible for Exchange - Equal MRP)
  await generateSale('INV-20260715-0001', customers.Kamal.id, createdVariants['890100000001'], 1, 'Classic Black Polo', 'Large', 'Black');

  // Scenario 2: Kamal bought Basic T-Shirt 2 days ago (Eligible - Higher MRP)
  await generateSale('INV-20260714-0002', customers.Kamal.id, createdVariants['890100000003'], 2, 'Basic T-Shirt', 'Medium', 'White');

  // Scenario 3: Kamal bought Winter Jacket 3 days ago (Eligible - Lower MRP)
  await generateSale('INV-20260713-0003', customers.Kamal.id, createdVariants['890100000007'], 3, 'Winter Jacket', 'XL', 'Black');

  // Scenario 4: Kamal bought Navy Hoodie 5 days ago (Expired - 3 day rule)
  await generateSale('INV-20260711-0004', customers.Kamal.id, createdVariants['890100000008'], 5, 'Navy Hoodie', 'Medium', 'Navy');

  // Scenario 5: Rohit bought Blue Jeans yesterday (Wrong Customer Test)
  await generateSale('INV-20260715-0005', customers.Rohit.id, createdVariants['890100000004'], 1, 'Blue Jeans', '32', 'Blue');

  // Scenario 6: Ankit bought Grey Lowers yesterday (Already Exchanged Test)
  const ankitSale = await generateSale('INV-20260715-0006', customers.Ankit.id, createdVariants['890100000006'], 1, 'Grey Lowers', 'Medium', 'Grey');
  
  // Create an exchange for Ankit's sale to fulfill "Already Exchanged"
  const existingExchange = await prisma.exchange.findFirst({ where: { originalSaleId: ankitSale.id } });
  if (!existingExchange && ankitSale.items && ankitSale.items.length > 0) {
     const saleItem = ankitSale.items[0];
     await prisma.exchange.create({
       data: {
         exchangeNumber: 'EXC-20260716-0001',
         originalSaleId: ankitSale.id,
         customerId: customers.Ankit.id,
         employeeId: employee.id,
         returnedValue: saleItem.totalPrice,
         issuedValue: saleItem.totalPrice,
         priceDifference: 0,
         exchangeReason: 'Wrong Size',
         status: 'COMPLETED',
         returnedItems: {
           create: {
             variantId: saleItem.variantId,
             quantity: 1,
             priceAtSale: saleItem.sellingPrice,
             totalValue: saleItem.totalPrice,
           }
         },
         issuedItems: {
           create: {
             variantId: createdVariants['890100000005'].id, // Issued Khaki Trousers instead
             quantity: 1,
             sellingPrice: saleItem.sellingPrice,
             totalValue: saleItem.totalPrice
           }
         }
       }
     });
     console.log(`Created Exchange: EXC-20260716-0001 for Ankit's sale`);
  }

  console.log("-----------------------------------------");
  console.log("✅ SEED SUCCESSFUL! Ready for QA.");
  console.log("-----------------------------------------");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
