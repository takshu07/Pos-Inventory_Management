require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../generated/prisma');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashedPassword = await bcrypt.hash('Demo@123', 10);
  await prisma.employee.update({
    where: { phone: '9999999999' },
    data: { password: hashedPassword, refreshTokenVersion: { increment: 1 } }
  });
  console.log("Password updated successfully to Demo@123");
}

main().catch(console.error).finally(() => prisma.$disconnect());
