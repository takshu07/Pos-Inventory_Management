/**
 * Lists barcodes for baggy-jeans variants. Temporary query script.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "./src/config/prisma";

async function main() {
  const products = await prisma.product.findMany({
    where: { name: { contains: "baggy", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      status: true,
      isActive: true,
      variants: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          currentStock: true,
          isActive: true,
          mrp: true,
          sellingPrice: true,
          size: { select: { name: true } },
          color: { select: { name: true } },
        },
        orderBy: { sku: "asc" },
      },
    },
  });

  const lines: string[] = [];

  if (products.length === 0) {
    lines.push("No product matching 'baggy' found.");
    // Fall back to listing every product so the name can be matched by eye.
    const all = await prisma.product.findMany({
      select: { name: true, _count: { select: { variants: true } } },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    lines.push(`\nProducts currently in the database (${all.length}):`);
    for (const p of all) lines.push(`  - ${p.name} (${p._count.variants} variants)`);
  }

  for (const product of products) {
    lines.push(`PRODUCT: ${product.name}  [${product.status}]`);
    lines.push(`  variants: ${product.variants.length}`);
    lines.push("");
    for (const v of product.variants) {
      const variantName = [v.color?.name, v.size?.name].filter(Boolean).join(" / ");
      lines.push(
        [
          `  ${v.barcode ?? "(no barcode)"}`,
          variantName.padEnd(16),
          v.sku,
          `stock=${v.currentStock}`,
          `mrp=${v.mrp}`,
          `sell=${v.sellingPrice}`,
          v.isActive ? "" : "(inactive)",
        ].join("  ")
      );
    }
    lines.push("");
  }

  const out = lines.join("\n");
  writeFileSync("baggy-barcodes.txt", out);
  console.log(out);
  await prisma.$disconnect();
}

void main();
