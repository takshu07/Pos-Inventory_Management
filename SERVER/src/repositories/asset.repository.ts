import { prisma } from "../config/prisma";
import type { Prisma, AssetStatus } from "../../generated/prisma";

export const assetRepository = {
  async create(data: Prisma.AssetUncheckedCreateInput) {
    return prisma.asset.create({ data });
  },

  async findById(id: string) {
    return prisma.asset.findUnique({ where: { id } });
  },

  async findByChecksum(checksum: string) {
    return prisma.asset.findFirst({ where: { checksum } });
  },

  async updateStatus(id: string, status: AssetStatus) {
    return prisma.asset.update({
      where: { id },
      data: { status }
    });
  },

  async delete(id: string) {
    return prisma.asset.delete({ where: { id } });
  },

  async findMany(params: {
    skip?: number;
    take?: number;
    where?: Prisma.AssetWhereInput;
    orderBy?: Prisma.AssetOrderByWithRelationInput;
  }) {
    const [items, total] = await Promise.all([
      prisma.asset.findMany({ ...params, include: { uploadedBy: { select: { firstName: true, lastName: true } } } }),
      prisma.asset.count({ where: params.where ?? {} })
    ]);
    return { items, total };
  }
};
