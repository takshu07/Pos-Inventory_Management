require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../generated/prisma');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const employee = await prisma.employee.findUnique({ where: { phone: '9999999999' }, select: { isActive: true } });
  console.log(employee);
}

main().catch(console.error).finally(() => prisma.$disconnect());
