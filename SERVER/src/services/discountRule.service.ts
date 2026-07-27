// =============================================================================
// DISCOUNT RULE SERVICE
//
// CRUD + lifecycle for catalog discount rules, and the dashboard/history reads
// behind the Discounts module.
//
// Two invariants this service is responsible for:
//
//  1. EVERY mutation is followed by a price recompute for the affected
//     variants, so the cached ProductVariant.sellingPrice never lags behind the
//     rules. (Reads and checkout resolve live regardless — see
//     effectivePrice.service — so this is about keeping catalog sorting and
//     filtering honest, not about correctness of the charged price.)
//
//  2. EVERY mutation writes a DiscountHistory row. The history survives rule
//     deletion (ruleName is snapshotted, the FK goes null), which is what makes
//     the History screen usable after a rule is removed.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import type { DiscountHistoryAction, DiscountStatus } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { deriveStatus } from "../engines/catalogPricing.engine";
import { auditRepository } from "../repositories/audit.repository";
import { discountRuleRepository, type DiscountRuleRow } from "../repositories/discountRule.repository";
import type { PaginatedResponse } from "../types/common.types";
import {
  countAffectedVariants,
  recomputeForRuleTarget,
} from "./effectivePrice.service";
import type {
  BulkDiscountInput,
  CreateCategoryDiscountInput,
  CreateProductDiscountInput,
  DiscountHistoryQuery,
  ListDiscountsQuery,
  UpdateDiscountInput,
} from "../validation/discountRule.validation";

// ── DTO ──────────────────────────────────────────────────────────────────────

export interface DiscountRuleDTO {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  type: string;
  value: number;
  priority: number;
  startDate: Date | null;
  endDate: Date | null;
  isEnabled: boolean;
  /** Derived at read time from (isEnabled, startDate, endDate) — never stored. */
  status: DiscountStatus;
  target: { id: string; name: string; type: "PRODUCT" | "CATEGORY" | "BRAND" } | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(rule: DiscountRuleRow, now: Date): DiscountRuleDTO {
  const target =
    rule.product != null
      ? { id: rule.product.id, name: rule.product.name, type: "PRODUCT" as const }
      : rule.category != null
        ? { id: rule.category.id, name: rule.category.name, type: "CATEGORY" as const }
        : rule.brand != null
          ? { id: rule.brand.id, name: rule.brand.name, type: "BRAND" as const }
          : null;

  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    scope: rule.scope,
    type: rule.type,
    value: Number(rule.value),
    priority: rule.priority,
    startDate: rule.startDate,
    endDate: rule.endDate,
    isEnabled: rule.isEnabled,
    status: deriveStatus(rule, now),
    target,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

// ── History ──────────────────────────────────────────────────────────────────

/**
 * Record a rule change. Fire-and-forget: a history write must never roll back
 * the business operation that triggered it — the same policy the audit
 * repository follows.
 */
function recordHistory(input: {
  ruleId: string | null;
  ruleName: string;
  action: DiscountHistoryAction;
  oldData?: unknown;
  newData?: unknown;
  employeeId: string;
}): void {
  prisma.discountHistory
    .create({
      data: {
        ruleId: input.ruleId,
        ruleName: input.ruleName,
        action: input.action,
        ...(input.oldData != null ? { oldData: input.oldData as Prisma.InputJsonValue } : {}),
        ...(input.newData != null ? { newData: input.newData as Prisma.InputJsonValue } : {}),
        employeeId: input.employeeId,
      },
    })
    .catch((err) => logger.error({ err, ruleId: input.ruleId }, "[Discounts] History write failed"));
}

function auditDiscount(
  action: "CREATE" | "UPDATE" | "DELETE",
  ruleId: string,
  executorId: string,
  oldData?: unknown,
  newData?: unknown
): void {
  auditRepository.create({
    performedBy: executorId,
    action,
    module: "DISCOUNT",
    tableName: "discount_rules",
    recordId: ruleId,
    ...(oldData != null ? { oldData: oldData as Record<string, unknown> } : {}),
    ...(newData != null ? { newData: newData as Record<string, unknown> } : {}),
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listDiscounts(
  query: ListDiscountsQuery
): Promise<PaginatedResponse<DiscountRuleDTO>> {
  const now = new Date();

  // Status is derived, so it cannot be filtered in SQL. We narrow as far as
  // possible in the database (scope/target/search) and apply the status filter
  // in memory afterwards; when a status filter is present we must fetch the
  // whole matching set to paginate correctly.
  const { rows, total } = await discountRuleRepository.findMany(query, !query.status);

  let dtos = rows.map((r) => toDTO(r, now));
  if (query.status) dtos = dtos.filter((d) => d.status === query.status);

  const effectiveTotal = query.status ? dtos.length : total;
  const data = query.status
    ? dtos.slice((query.page - 1) * query.limit, query.page * query.limit)
    : dtos;

  const totalPages = Math.ceil(effectiveTotal / query.limit) || 1;

  return {
    data,
    meta: {
      total: effectiveTotal,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

export async function getDiscountById(id: string): Promise<DiscountRuleDTO> {
  const rule = await discountRuleRepository.findById(id);
  if (!rule) throw new AppError(HTTP_STATUS.NOT_FOUND, "Discount not found.");
  return toDTO(rule, new Date());
}

/** Dashboard counters + the rules feeding each panel. */
export async function getDashboard() {
  const now = new Date();
  const all = await discountRuleRepository.findAllForDashboard();
  const dtos = all.map((r) => toDTO(r, now));

  const by = (s: DiscountStatus) => dtos.filter((d) => d.status === s);
  const active = by("ACTIVE");
  const scheduled = by("SCHEDULED");
  const expired = by("EXPIRED");
  const disabled = by("DISABLED");

  // "Ending soon" drives the dashboard's urgency panel.
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endingSoon = active.filter((d) => d.endDate != null && d.endDate <= sevenDays);

  return {
    counts: {
      total: dtos.length,
      active: active.length,
      scheduled: scheduled.length,
      expired: expired.length,
      disabled: disabled.length,
      endingSoon: endingSoon.length,
      productScoped: dtos.filter((d) => d.scope === "PRODUCT").length,
      categoryScoped: dtos.filter((d) => d.scope === "CATEGORY").length,
    },
    active: active.slice(0, 10),
    scheduled: scheduled.slice(0, 10),
    expired: expired.slice(0, 10),
    endingSoon: endingSoon.slice(0, 10),
    recentlyModified: [...dtos]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 10),
  };
}

export async function listHistory(query: DiscountHistoryQuery) {
  return discountRuleRepository.findHistory(query);
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function createRule(
  data: (CreateProductDiscountInput | CreateCategoryDiscountInput) & {
    scope: "PRODUCT" | "CATEGORY";
  },
  executorId: string
): Promise<DiscountRuleDTO & { affectedVariants: number }> {
  const productId = "productId" in data ? data.productId : null;
  const categoryId = "categoryId" in data ? data.categoryId : null;

  // Verify the target exists — a rule pointing at nothing would silently never
  // apply, which is far more confusing than an immediate 404.
  if (productId) {
    const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!exists) throw new AppError(HTTP_STATUS.NOT_FOUND, "Product not found.");
  } else if (categoryId) {
    const exists = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!exists) throw new AppError(HTTP_STATUS.NOT_FOUND, "Category not found.");
  }

  const created = await discountRuleRepository.create({
    name: data.name,
    description: data.description ?? null,
    scope: data.scope,
    type: data.type,
    value: new Prisma.Decimal(data.value),
    productId,
    categoryId,
    brandId: null,
    priority: data.priority,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    isEnabled: data.isEnabled,
    createdById: executorId,
  });

  const { affected, deferred } = await recomputeForRuleTarget({
    scope: data.scope,
    productId,
    categoryId,
  });

  recordHistory({
    ruleId: created.id,
    ruleName: created.name,
    action: "CREATED",
    newData: created,
    employeeId: executorId,
  });
  auditDiscount("CREATE", created.id, executorId, null, created);

  logger.info(
    { executorId, ruleId: created.id, scope: data.scope, affected, deferred },
    "[Discounts] Rule created"
  );

  return { ...toDTO(created, new Date()), affectedVariants: affected + deferred };
}

export function createProductDiscount(data: CreateProductDiscountInput, executorId: string) {
  return createRule({ ...data, scope: "PRODUCT" }, executorId);
}

export function createCategoryDiscount(data: CreateCategoryDiscountInput, executorId: string) {
  return createRule({ ...data, scope: "CATEGORY" }, executorId);
}

export async function updateDiscount(
  id: string,
  data: UpdateDiscountInput,
  executorId: string
): Promise<DiscountRuleDTO & { affectedVariants: number }> {
  const existing = await discountRuleRepository.findById(id);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Discount not found.");

  const updated = await discountRuleRepository.update(id, {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.type !== undefined ? { type: data.type } : {}),
    ...(data.value !== undefined ? { value: new Prisma.Decimal(data.value) } : {}),
    ...(data.priority !== undefined ? { priority: data.priority } : {}),
    ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
    ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
    ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
  });

  const { affected, deferred } = await recomputeForRuleTarget({
    scope: existing.scope,
    productId: existing.productId,
    categoryId: existing.categoryId,
    brandId: existing.brandId,
  });

  // A toggled enable/disable is recorded as its own action so the History
  // screen can show "Disabled by X" rather than a generic "Updated".
  const action: DiscountHistoryAction =
    data.isEnabled === true && !existing.isEnabled
      ? "ENABLED"
      : data.isEnabled === false && existing.isEnabled
        ? "DISABLED"
        : "UPDATED";

  recordHistory({
    ruleId: id,
    ruleName: updated.name,
    action,
    oldData: existing,
    newData: updated,
    employeeId: executorId,
  });
  auditDiscount("UPDATE", id, executorId, existing, updated);

  logger.info({ executorId, ruleId: id, action, affected, deferred }, "[Discounts] Rule updated");

  return { ...toDTO(updated, new Date()), affectedVariants: affected + deferred };
}

export async function deleteDiscount(id: string, executorId: string): Promise<{ affectedVariants: number }> {
  const existing = await discountRuleRepository.findById(id);
  if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, "Discount not found.");

  await discountRuleRepository.remove(id);

  // Recompute AFTER deletion, using the target captured beforehand — the row is
  // gone, so the scope/target can no longer be read from it.
  const { affected, deferred } = await recomputeForRuleTarget({
    scope: existing.scope,
    productId: existing.productId,
    categoryId: existing.categoryId,
    brandId: existing.brandId,
  });

  recordHistory({
    ruleId: null, // FK is cleared by onDelete: SetNull; ruleName preserves identity
    ruleName: existing.name,
    action: "DELETED",
    oldData: existing,
    employeeId: executorId,
  });
  auditDiscount("DELETE", id, executorId, existing, null);

  logger.info({ executorId, ruleId: id, affected, deferred }, "[Discounts] Rule deleted");
  return { affectedVariants: affected + deferred };
}

/** Bulk enable / disable / delete from the dashboard's selection toolbar. */
export async function bulkAction(
  data: BulkDiscountInput,
  executorId: string
): Promise<{ processed: number; affectedVariants: number }> {
  const rules = await discountRuleRepository.findManyByIds(data.ids);
  if (rules.length === 0) throw new AppError(HTTP_STATUS.NOT_FOUND, "No matching discounts found.");

  if (data.action === "DELETE") {
    await discountRuleRepository.removeMany(rules.map((r) => r.id));
  } else {
    await discountRuleRepository.setEnabled(
      rules.map((r) => r.id),
      data.action === "ENABLE"
    );
  }

  // One recompute per distinct target, not per rule — several rules commonly
  // point at the same category, and repricing it repeatedly is pure waste.
  const seen = new Set<string>();
  let affectedVariants = 0;
  for (const r of rules) {
    const key = `${r.scope}:${r.productId ?? r.categoryId ?? r.brandId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { affected, deferred } = await recomputeForRuleTarget({
      scope: r.scope,
      productId: r.productId,
      categoryId: r.categoryId,
      brandId: r.brandId,
    });
    affectedVariants += affected + deferred;
  }

  const action: DiscountHistoryAction =
    data.action === "DELETE" ? "DELETED" : data.action === "ENABLE" ? "ENABLED" : "DISABLED";

  for (const r of rules) {
    recordHistory({
      ruleId: data.action === "DELETE" ? null : r.id,
      ruleName: r.name,
      action,
      oldData: r,
      employeeId: executorId,
    });
  }

  logger.info(
    { executorId, action: data.action, count: rules.length, affectedVariants },
    "[Discounts] Bulk action applied"
  );

  return { processed: rules.length, affectedVariants };
}

/**
 * How many variants a proposed rule would touch — powers the "this affects N
 * products" hint in the rule editor before the owner commits.
 */
export async function previewImpact(target: {
  scope: "PRODUCT" | "CATEGORY";
  productId?: string | undefined;
  categoryId?: string | undefined;
}): Promise<{ affectedVariants: number }> {
  const affectedVariants = await countAffectedVariants({
    scope: target.scope,
    productId: target.productId ?? null,
    categoryId: target.categoryId ?? null,
  });
  return { affectedVariants };
}
