import { faker } from "@faker-js/faker";
import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma";
import { EmployeeRole, Gender } from "../../../generated/prisma";

export const EmployeeFactory = {
  async create(overrides: Partial<Parameters<typeof prisma.employee.create>[0]["data"]> = {}) {
    const defaultPassword = await bcrypt.hash("Password123!", 10);
    const data = {
      employeeCode: faker.string.alphanumeric(8).toUpperCase(),
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      email: faker.internet.email(),
      phone: faker.phone.number({ style: "national" }).replace(/\D/g, '').substring(0, 10),
      password: defaultPassword,
      role: EmployeeRole.CASHIER,
      gender: Gender.MALE,
      joiningDate: new Date(),
      ...overrides,
    };
    return prisma.employee.create({ data });
  },

  async createOwner() {
    return this.create({ role: EmployeeRole.OWNER });
  },

  async createManager() {
    return this.create({ role: EmployeeRole.MANAGER });
  }
};
