// =============================================================================
// LABEL TEMPLATE SERVICE
//
// Template administration (OWNER) plus the seeding that guarantees every
// install has the built-in templates available as real, referenceable rows.
//
// System templates are protected: they may be cloned or deactivated, never
// deleted or structurally rewritten. Losing "default-clothing" would break
// every module that requests it by code.
// =============================================================================

import {
  ActionModule,
  ActionType,
  type BarcodeSymbology,
  type LabelTemplateKind,
  type Prisma,
} from "../../generated/prisma";
import { logger } from "../config/logger";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import {
  BUILTIN_TEMPLATES,
  FALLBACK_TEMPLATE_CODE,
} from "../engines/label/templates/builtinTemplates";
import {
  resolveBuiltinTemplate,
  resolveTemplate,
  validateTemplate,
  type TemplateValidationIssue,
} from "../engines/label/templates/template.engine";
import type { LabelElement } from "../engines/label/label.types";
import { auditRepository } from "../repositories/audit.repository";
import {
  labelTemplateRepository,
  type LabelTemplateRow,
  type ListTemplatesQuery,
} from "../repositories/labelTemplate.repository";

// ─── Seeding ──────────────────────────────────────────────────────────────────

let seedPromise: Promise<void> | null = null;

/**
 * Seeds the built-in templates as isSystem rows.
 *
 * Idempotent and memoised: called on server start and lazily before any
 * template lookup, so a fresh database is usable without a manual seed step.
 * The promise is cached so concurrent first-requests don't all seed at once.
 */
export async function ensureSystemTemplates(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    for (const builtin of BUILTIN_TEMPLATES) {
      const elements = builtin.elements as unknown as Prisma.InputJsonValue;

      const createData: Prisma.LabelTemplateCreateInput = {
        code: builtin.code,
        name: builtin.name,
        description: builtin.description,
        kind: builtin.kind,
        widthMm: builtin.widthMm,
        heightMm: builtin.heightMm,
        marginTopMm: builtin.margins.top,
        marginRightMm: builtin.margins.right,
        marginBottomMm: builtin.margins.bottom,
        marginLeftMm: builtin.margins.left,
        elements,
        barcodeSymbology: builtin.barcodeSymbology,
        rotation: builtin.rotation,
        isSystem: true,
      };

      // Refresh geometry only — never name/isActive, which an owner may have
      // customised. A restart must not silently undo their changes.
      const updateData: Prisma.LabelTemplateUpdateInput = {
        widthMm: builtin.widthMm,
        heightMm: builtin.heightMm,
        marginTopMm: builtin.margins.top,
        marginRightMm: builtin.margins.right,
        marginBottomMm: builtin.margins.bottom,
        marginLeftMm: builtin.margins.left,
        elements,
        barcodeSymbology: builtin.barcodeSymbology,
        isSystem: true,
      };

      await labelTemplateRepository.upsertSystemTemplate(
        builtin.code,
        createData,
        updateData
      );
    }

    logger.info(
      { count: BUILTIN_TEMPLATES.length },
      "[LabelEngine] System templates seeded"
    );
  })().catch((err) => {
    // Reset so a transient DB failure doesn't permanently poison seeding.
    seedPromise = null;
    logger.error({ err }, "[LabelEngine] System template seeding failed");
    throw err;
  });

  return seedPromise;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listTemplates(
  query: ListTemplatesQuery = {}
): Promise<LabelTemplateRow[]> {
  await ensureSystemTemplates();
  return labelTemplateRepository.findMany(query);
}

export async function getTemplateById(id: string): Promise<LabelTemplateRow> {
  const template = await labelTemplateRepository.findById(id);
  if (!template) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Label template not found.");
  }
  return template;
}

/**
 * Resolves the template to use for a print request.
 *
 * Resolution order — explicit id → configured default → the fallback built-in.
 * The last step matters: a print must never fail merely because no default has
 * been configured yet.
 */
export async function resolveTemplateForPrint(
  templateId: string | null | undefined,
  defaultTemplateId: string | null | undefined
): Promise<LabelTemplateRow> {
  await ensureSystemTemplates();

  if (templateId) {
    const explicit = await labelTemplateRepository.findById(templateId);
    if (!explicit) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "The selected label template no longer exists.");
    }
    if (!explicit.isActive) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        `Template "${explicit.name}" is inactive and cannot be used for printing.`
      );
    }
    return explicit;
  }

  if (defaultTemplateId) {
    const configured = await labelTemplateRepository.findById(defaultTemplateId);
    if (configured?.isActive) return configured;
  }

  const fallback = await labelTemplateRepository.findByCode(FALLBACK_TEMPLATE_CODE);
  if (!fallback) {
    throw new AppError(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "No label template is available. The default templates could not be loaded."
    );
  }
  return fallback;
}

// ─── Writes (OWNER only — enforced at the route layer) ────────────────────────

/**
 * Template create/update payload.
 *
 * Optional fields spell out `| undefined` because this is populated directly
 * from a Zod-parsed body and the project compiles with
 * exactOptionalPropertyTypes — without it, every controller would need a
 * conditional spread per field.
 *
 * `barcodeSymbology`, `margins` and `kind` are required here because the
 * validation layer supplies defaults for them, so the service can rely on
 * their presence.
 */
export interface TemplateWriteInput {
  code?: string | undefined;
  name: string;
  description?: string | null | undefined;
  kind: LabelTemplateKind;
  widthMm: number;
  heightMm: number;
  margins: { top: number; right: number; bottom: number; left: number };
  elements: LabelElement[];
  barcodeSymbology: BarcodeSymbology;
  rotation?: number | undefined;
  isActive?: boolean | undefined;
}

/** Rejects a template whose geometry is unusable. Warnings are allowed. */
function assertValid(input: TemplateWriteInput): TemplateValidationIssue[] {
  const issues = validateTemplate({
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    margins: input.margins,
    elements: input.elements,
  });

  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new AppError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      `This template layout is invalid: ${errors.map((e) => e.message).join(" ")}`,
      { issues: errors }
    );
  }
  return issues;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function createTemplate(
  input: TemplateWriteInput,
  actorId: string
): Promise<{ template: LabelTemplateRow; warnings: TemplateValidationIssue[] }> {
  const issues = assertValid(input);

  const code = input.code?.trim() || slugify(input.name);
  const existing = await labelTemplateRepository.findByCode(code);
  if (existing) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `A template with the code "${code}" already exists.`
    );
  }

  const template = await labelTemplateRepository.create({
    code,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    marginTopMm: input.margins.top,
    marginRightMm: input.margins.right,
    marginBottomMm: input.margins.bottom,
    marginLeftMm: input.margins.left,
    elements: input.elements as unknown as Prisma.InputJsonValue,
    barcodeSymbology: input.barcodeSymbology,
    rotation: input.rotation ?? 0,
    isActive: input.isActive ?? true,
    isSystem: false,
    createdBy: { connect: { id: actorId } },
  });

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.CREATE,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: template.id,
    newData: { code: template.code, name: template.name, kind: template.kind },
  });

  return { template, warnings: issues.filter((i) => i.severity === "warning") };
}

export async function updateTemplate(
  id: string,
  input: TemplateWriteInput,
  actorId: string
): Promise<{ template: LabelTemplateRow; warnings: TemplateValidationIssue[] }> {
  const existing = await getTemplateById(id);

  // System templates are the safety net every module falls back to. Allowing
  // an edit that breaks one would break printing globally, so they must be
  // cloned instead.
  if (existing.isSystem) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      `"${existing.name}" is a built-in template and cannot be edited. Duplicate it to create an editable copy.`,
      { reason: "SYSTEM_TEMPLATE_READONLY" }
    );
  }

  const issues = assertValid(input);

  const template = await labelTemplateRepository.update(id, {
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    marginTopMm: input.margins.top,
    marginRightMm: input.margins.right,
    marginBottomMm: input.margins.bottom,
    marginLeftMm: input.margins.left,
    elements: input.elements as unknown as Prisma.InputJsonValue,
    barcodeSymbology: input.barcodeSymbology,
    rotation: input.rotation ?? 0,
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  });

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.LABEL_TEMPLATE_CHANGED,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: template.id,
    oldData: { name: existing.name, elements: existing.elements },
    newData: { name: template.name, elements: template.elements },
  });

  return { template, warnings: issues.filter((i) => i.severity === "warning") };
}

/** Clones any template (including system ones) into an editable copy. */
export async function duplicateTemplate(
  id: string,
  actorId: string,
  newName?: string
): Promise<LabelTemplateRow> {
  const source = await getTemplateById(id);

  const baseName = newName?.trim() || `${source.name} (Copy)`;
  let code = slugify(baseName);

  // Codes are unique; append a counter rather than failing the request.
  let suffix = 1;
  while (await labelTemplateRepository.findByCode(code)) {
    suffix += 1;
    code = `${slugify(baseName)}-${suffix}`;
  }

  const template = await labelTemplateRepository.create({
    code,
    name: baseName,
    description: source.description,
    kind: source.kind,
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    marginTopMm: source.marginTopMm,
    marginRightMm: source.marginRightMm,
    marginBottomMm: source.marginBottomMm,
    marginLeftMm: source.marginLeftMm,
    elements: source.elements as Prisma.InputJsonValue,
    barcodeSymbology: source.barcodeSymbology,
    rotation: source.rotation,
    isActive: true,
    isSystem: false,
    createdBy: { connect: { id: actorId } },
  });

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.CREATE,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: template.id,
    newData: { code: template.code, name: template.name, duplicatedFrom: source.code },
  });

  return template;
}

/**
 * Deletes a template, or deactivates it when print history references it.
 *
 * History must stay readable: deleting a template that past jobs point at
 * would either orphan those rows or cascade away the audit trail.
 */
export async function deleteTemplate(
  id: string,
  actorId: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const existing = await getTemplateById(id);

  if (existing.isSystem) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      `"${existing.name}" is a built-in template and cannot be deleted. Deactivate it instead.`,
      { reason: "SYSTEM_TEMPLATE_READONLY" }
    );
  }

  const jobCount = await labelTemplateRepository.countJobsFor(id);

  if (jobCount > 0) {
    await labelTemplateRepository.deactivate(id);
    void auditRepository.create({
      performedBy: actorId,
      action: ActionType.UPDATE,
      module: ActionModule.LABEL,
      tableName: "label_templates",
      recordId: id,
      newData: { isActive: false, reason: "Referenced by print history" },
    });
    return { deleted: false, deactivated: true };
  }

  await labelTemplateRepository.remove(id);
  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.DELETE,
    module: ActionModule.LABEL,
    tableName: "label_templates",
    recordId: id,
    oldData: { code: existing.code, name: existing.name },
  });

  return { deleted: true, deactivated: false };
}

/** Validates a draft layout without saving — powers the designer's live panel. */
export function validateDraft(input: {
  widthMm: number;
  heightMm: number;
  margins: { top: number; right: number; bottom: number; left: number };
  elements: LabelElement[];
}): TemplateValidationIssue[] {
  return validateTemplate(input);
}

/** The built-in catalogue, for the "start from a built-in" picker. */
export function listBuiltins() {
  return BUILTIN_TEMPLATES.map((builtin) => {
    const resolved = resolveBuiltinTemplate(builtin);
    return {
      code: resolved.code,
      name: resolved.name,
      description: builtin.description,
      kind: resolved.kind,
      widthMm: resolved.widthMm,
      heightMm: resolved.heightMm,
      elementCount: resolved.elements.length,
    };
  });
}

export { resolveTemplate };
