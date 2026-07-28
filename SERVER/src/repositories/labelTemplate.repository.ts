// =============================================================================
// LABEL TEMPLATE REPOSITORY
// All database access for label_templates.
//
// System templates (isSystem=true) are seeded from the built-in registry. They
// can be cloned and deactivated but never deleted or structurally renamed, so
// an install always retains a working set of defaults.
// =============================================================================

import type { LabelTemplateKind, Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";

const TEMPLATE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  kind: true,
  widthMm: true,
  heightMm: true,
  marginTopMm: true,
  marginRightMm: true,
  marginBottomMm: true,
  marginLeftMm: true,
  elements: true,
  barcodeSymbology: true,
  rotation: true,
  isSystem: true,
  isActive: true,
  storeCode: true,
  usageCount: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LabelTemplateSelect;

export type LabelTemplateRow = Prisma.LabelTemplateGetPayload<{
  select: typeof TEMPLATE_SELECT;
}>;

export interface ListTemplatesQuery {
  kind?: LabelTemplateKind | undefined;
  includeInactive?: boolean | undefined;
  search?: string | undefined;
}

async function findMany(query: ListTemplatesQuery = {}): Promise<LabelTemplateRow[]> {
  return prisma.labelTemplate.findMany({
    where: {
      ...(query.kind && { kind: query.kind }),
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { code: { contains: query.search, mode: "insensitive" as const } },
        ],
      }),
    },
    select: TEMPLATE_SELECT,
    // System templates first, then most-used — matches how the picker is used.
    orderBy: [{ isSystem: "desc" }, { usageCount: "desc" }, { name: "asc" }],
  });
}

async function findById(id: string): Promise<LabelTemplateRow | null> {
  return prisma.labelTemplate.findUnique({
    where: { id },
    select: TEMPLATE_SELECT,
  });
}

async function findByCode(code: string): Promise<LabelTemplateRow | null> {
  return prisma.labelTemplate.findUnique({
    where: { code },
    select: TEMPLATE_SELECT,
  });
}

async function create(
  data: Prisma.LabelTemplateCreateInput
): Promise<LabelTemplateRow> {
  return prisma.labelTemplate.create({ data, select: TEMPLATE_SELECT });
}

async function update(
  id: string,
  data: Prisma.LabelTemplateUpdateInput
): Promise<LabelTemplateRow> {
  return prisma.labelTemplate.update({
    where: { id },
    data,
    select: TEMPLATE_SELECT,
  });
}

async function remove(id: string): Promise<void> {
  await prisma.labelTemplate.delete({ where: { id } });
}

async function deactivate(id: string): Promise<LabelTemplateRow> {
  return prisma.labelTemplate.update({
    where: { id },
    data: { isActive: false },
    select: TEMPLATE_SELECT,
  });
}

/**
 * Increments the usage counter after a successful print.
 *
 * Fire-and-forget at the call site: a failed counter update must never fail a
 * print job that already produced physical labels.
 */
async function incrementUsage(id: string): Promise<void> {
  await prisma.labelTemplate.update({
    where: { id },
    data: { usageCount: { increment: 1 } },
  });
}

async function countJobsFor(templateId: string): Promise<number> {
  return prisma.printJob.count({ where: { templateId } });
}

/**
 * Idempotently seeds a system template.
 *
 * `update` deliberately refreshes only the LAYOUT, never `name`/`isActive` — an
 * owner may have renamed or disabled a system template, and a server restart
 * must not silently undo that.
 */
async function upsertSystemTemplate(
  code: string,
  create: Prisma.LabelTemplateCreateInput,
  layoutUpdate: Prisma.LabelTemplateUpdateInput
): Promise<LabelTemplateRow> {
  return prisma.labelTemplate.upsert({
    where: { code },
    create,
    update: layoutUpdate,
    select: TEMPLATE_SELECT,
  });
}

export const labelTemplateRepository = {
  findMany,
  findById,
  findByCode,
  create,
  update,
  remove,
  deactivate,
  incrementUsage,
  countJobsFor,
  upsertSystemTemplate,
} as const;
