import { prisma } from "../config/prisma";
import { z } from "zod";
import * as schemas from "../validation/configuration.validation";
import { logger } from "../config/logger";

// Infer types from Zod Schemas
export type StoreConfig = z.infer<typeof schemas.storeConfigSchema>;
export type InvoiceConfig = z.infer<typeof schemas.invoiceConfigSchema>;
export type PricingConfig = z.infer<typeof schemas.pricingConfigSchema>;
export type ExchangeConfig = z.infer<typeof schemas.exchangeConfigSchema>;
export type InventoryConfig = z.infer<typeof schemas.inventoryConfigSchema>;
export type SecurityConfig = z.infer<typeof schemas.securityConfigSchema>;
export type ReportingConfig = z.infer<typeof schemas.reportingConfigSchema>;

export interface FullConfiguration {
  storeName: string;
  currency: string;
  timeZone: string;
  version: number;
  storeConfig: StoreConfig;
  invoiceConfig: InvoiceConfig;
  pricingConfig: PricingConfig;
  exchangeConfig: ExchangeConfig;
  inventoryConfig: InventoryConfig;
  securityConfig: SecurityConfig;
  reportingConfig: ReportingConfig;
}

export class ConfigurationEngine {
  private static cache: FullConfiguration | null = null;
  private static isInitializing = false;
  private static initPromise: Promise<void> | null = null;

  /**
   * Initializes the in-memory cache from PostgreSQL.
   * Uses a promise lock to prevent race conditions on cold boot.
   */
  static async init(forceReload = false): Promise<void> {
    if (this.cache && !forceReload) return;
    
    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        const rawSettings = await prisma.settings.findUnique({
          where: { id: "singleton" }
        });

        if (!rawSettings) {
          // If DB is empty, rely on Zod defaults to build a functional state
          this.cache = this.buildDefaults();
          logger.warn("ConfigurationEngine initialized with default settings. Database singleton missing.");
        } else {
          // Parse JSON from DB against Zod schemas to ensure absolute type safety.
          // If a JSON block is malformed in DB, Zod will fill missing keys with defaults.
          this.cache = {
            storeName: rawSettings.storeName,
            currency: rawSettings.currency,
            timeZone: rawSettings.timeZone,
            version: rawSettings.version,
            storeConfig: schemas.storeConfigSchema.parse(rawSettings.storeConfig || {}),
            invoiceConfig: schemas.invoiceConfigSchema.parse(rawSettings.invoiceConfig || {}),
            pricingConfig: schemas.pricingConfigSchema.parse(rawSettings.pricingConfig || {}),
            exchangeConfig: schemas.exchangeConfigSchema.parse(rawSettings.exchangeConfig || {}),
            inventoryConfig: schemas.inventoryConfigSchema.parse(rawSettings.inventoryConfig || {}),
            securityConfig: schemas.securityConfigSchema.parse(rawSettings.securityConfig || {}),
            reportingConfig: schemas.reportingConfigSchema.parse(rawSettings.reportingConfig || {}),
          };
          logger.info(`ConfigurationEngine initialized. Version: ${this.cache.version}`);
        }
      } catch (error) {
        logger.error({ err: error }, "ConfigurationEngine failed to parse database settings.");
        throw new Error("CRITICAL: POS Configuration is corrupted.");
      } finally {
        this.isInitializing = false;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Invalidates the cache, forcing the next read to fetch from DB.
   * To be called via webhooks in multi-instance deployments.
   */
  static invalidateCache() {
    this.cache = null;
    logger.info("ConfigurationEngine cache invalidated.");
  }

  // ==========================================================================
  // STRONGLY TYPED GETTERS
  // ==========================================================================

  private static ensureCache(): FullConfiguration {
    if (!this.cache) {
      // In Express, synchronous cache misses are dangerous.
      // We must ensure `await ConfigurationEngine.init()` is called at server boot.
      throw new Error("ConfigurationEngine accessed before initialization.");
    }
    return this.cache;
  }

  static getStoreName(): string { return this.ensureCache().storeName; }
  static getCurrency(): string { return this.ensureCache().currency; }
  static getTimeZone(): string { return this.ensureCache().timeZone; }
  
  static getStoreSettings(): StoreConfig { return this.ensureCache().storeConfig; }
  static getInvoiceSettings(): InvoiceConfig { return this.ensureCache().invoiceConfig; }
  static getPricingSettings(): PricingConfig { return this.ensureCache().pricingConfig; }
  static getExchangeSettings(): ExchangeConfig { return this.ensureCache().exchangeConfig; }
  static getInventorySettings(): InventoryConfig { return this.ensureCache().inventoryConfig; }
  static getSecuritySettings(): SecurityConfig { return this.ensureCache().securityConfig; }
  static getReportingSettings(): ReportingConfig { return this.ensureCache().reportingConfig; }

  // ==========================================================================
  // DEFAULT BUILDER
  // ==========================================================================
  private static buildDefaults(): FullConfiguration {
    return {
      storeName: "Default Store",
      currency: "INR",
      timeZone: "Asia/Kolkata",
      version: 1,
      storeConfig: schemas.storeConfigSchema.parse({}),
      invoiceConfig: schemas.invoiceConfigSchema.parse({}),
      pricingConfig: schemas.pricingConfigSchema.parse({}),
      exchangeConfig: schemas.exchangeConfigSchema.parse({}),
      inventoryConfig: schemas.inventoryConfigSchema.parse({}),
      securityConfig: schemas.securityConfigSchema.parse({}),
      reportingConfig: schemas.reportingConfigSchema.parse({})
    };
  }
}
