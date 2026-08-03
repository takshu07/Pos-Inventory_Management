/**
 * Configuration service — the single write path for the settings singleton.
 *
 * WHY PARTIAL UPDATES ARE MERGED, NOT ASSIGNED
 * --------------------------------------------
 * Each `*Config` column is one JSON blob. Assigning `data.pricingConfig` writes
 * the WHOLE column, so a PATCH carrying only `{ defaultTaxRate: 5 }` would drop
 * every sibling key — the discount ladder, the rounding strategy, tax-inclusive
 * pricing. Zod then re-fills the missing keys from `.default()` on the next
 * engine load, so nothing throws and nothing looks broken: the store silently
 * reverts to stock business rules. That is a data-loss bug that reads as a
 * config bug days later, and it is the reason `mergeConfigBlock` exists (kept in
 * utils/configMerge.ts so the rule is unit-testable without a database).
 *
 * Every block is therefore read, merged key-by-key over the stored value, and
 * written back whole. Sending a complete block behaves identically, so this is
 * a strict widening of what the endpoint accepted before.
 *
 * ORDER OF OPERATIONS (each step exists to keep a failure from being partial):
 *   1. Read the current row.
 *   2. Merge the patch over it, in memory.
 *   3. Validate the MERGED result — cross-field rules cannot be checked on a
 *      patch that carries one half of a pair. Reject before any write.
 *   4. Write, bumping `version`.
 *   5. Reload the engine cache from the row that was actually persisted.
 */

import { configurationRepository } from "../repositories/configuration.repository";
import { ConfigurationEngine } from "../engines/configuration.engine";
import {
  configurationUpdateSchema,
  findConfigurationConflicts,
} from "../validation/configuration.validation";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { mergeConfigBlock } from "../utils/configMerge";
import type { z } from "zod";

type UpdatePayload = z.infer<typeof configurationUpdateSchema>["body"];

/** The JSON columns this service manages, and their payload keys. */
const CONFIG_BLOCKS = [
  "storeConfig",
  "invoiceConfig",
  "pricingConfig",
  "exchangeConfig",
  "inventoryConfig",
  "securityConfig",
  "reportingConfig",
  "systemConfig",
  "integrationConfig",
] as const;

type ConfigBlock = (typeof CONFIG_BLOCKS)[number];

/**
 * Maps a logical block to the physical column backing it.
 *
 * `systemConfig` and `integrationConfig` were added in 2026-08 on top of two
 * columns the schema already declared but nothing ever read (`customerConfig`,
 * `notificationConfig`). Reusing them keeps the feature migration-free. The
 * indirection lives here so the rest of the codebase — engine getters, API
 * payloads, the client — only ever sees the logical name.
 */
const COLUMN_FOR_BLOCK: Record<ConfigBlock, string> = {
  storeConfig: "storeConfig",
  invoiceConfig: "invoiceConfig",
  pricingConfig: "pricingConfig",
  exchangeConfig: "exchangeConfig",
  inventoryConfig: "inventoryConfig",
  securityConfig: "securityConfig",
  reportingConfig: "reportingConfig",
  systemConfig: "customerConfig",
  integrationConfig: "notificationConfig",
};

export const configurationService = {
  /**
   * Retrieves the fully typed configuration payload directly from the Engine cache.
   * O(1) memory lookup. Zero database reads.
   *
   * `version` is included so a client can tell whether the copy it is holding is
   * still current; it increments on every successful write.
   */
  getFullConfiguration() {
    return {
      storeName: ConfigurationEngine.getStoreName(),
      currency: ConfigurationEngine.getCurrency(),
      timeZone: ConfigurationEngine.getTimeZone(),
      version: ConfigurationEngine.getVersion(),
      storeConfig: ConfigurationEngine.getStoreSettings(),
      invoiceConfig: ConfigurationEngine.getInvoiceSettings(),
      pricingConfig: ConfigurationEngine.getPricingSettings(),
      exchangeConfig: ConfigurationEngine.getExchangeSettings(),
      inventoryConfig: ConfigurationEngine.getInventorySettings(),
      securityConfig: ConfigurationEngine.getSecuritySettings(),
      reportingConfig: ConfigurationEngine.getReportingSettings(),
      systemConfig: ConfigurationEngine.getSystemSettings(),
      integrationConfig: ConfigurationEngine.getIntegrationSettings(),
    };
  },

  /**
   * Validates and updates the configuration, then forces the Engine to flush its
   * cache and reload from the database.
   *
   * `expectedVersion` is optional optimistic concurrency. When supplied and it
   * no longer matches the stored row, the write is refused with 409 rather than
   * silently overwriting whatever the other owner just saved. Omitting it keeps
   * the previous last-write-wins behaviour, so existing callers are unaffected.
   */
  async updateConfiguration(
    payload: UpdatePayload,
    employeeId: string,
    expectedVersion?: number
  ) {
    const current = await configurationRepository.getRawSettings();
    if (!current) {
      throw new AppError(
        HTTP_STATUS.NOT_FOUND,
        "Store configuration has not been initialised. Run the database seed."
      );
    }

    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "These settings were changed by someone else while you were editing. Reload to see the current values before saving again.",
        { reason: "SETTINGS_VERSION_CONFLICT", currentVersion: current.version }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Scalars: assign only what was sent.
    if (payload.storeName !== undefined) updateData.storeName = payload.storeName;
    if (payload.currency !== undefined) updateData.currency = payload.currency;
    if (payload.timeZone !== undefined) updateData.timeZone = payload.timeZone;

    // JSON blocks: merge over stored, never replace. See the file header.
    const merged: Record<string, Record<string, unknown>> = {};
    const row = current as unknown as Record<string, unknown>;

    for (const block of CONFIG_BLOCKS) {
      const column = COLUMN_FOR_BLOCK[block];
      const patch = payload[block] as Record<string, unknown> | undefined;
      const next = mergeConfigBlock(row[column], patch);
      merged[block] = next;

      // Only write columns the caller actually touched, so an unrelated save
      // does not rewrite (and re-audit) every block on the row.
      if (patch !== undefined) updateData[column] = next;
    }

    // Cross-field rules run against the MERGED state — a patch carrying one half
    // of a pair cannot be judged on its own. Rejecting here means an invalid
    // combination never reaches the database or the engine cache.
    const conflicts = findConfigurationConflicts(merged as never);
    if (conflicts.length > 0) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, conflicts[0]!, {
        reason: "SETTINGS_CONSTRAINT_VIOLATION",
        conflicts,
      });
    }

    await configurationRepository.updateSettings(updateData, employeeId);

    // FLUSH CACHE & RELOAD
    ConfigurationEngine.invalidateCache();
    await ConfigurationEngine.init(true);

    return this.getFullConfiguration();
  },
};
