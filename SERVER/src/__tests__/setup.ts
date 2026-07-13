import { beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../config/prisma";
import { cleanDatabase } from "./utils/db";

beforeAll(async () => {
  // Connect to DB or ensure it's ready
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe all transactional tables before each test for total isolation
  // Or handle isolation at the suite level if speed is prioritized
  await cleanDatabase();
});
