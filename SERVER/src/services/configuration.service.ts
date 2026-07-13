import { configurationRepository } from "../repositories/configuration.repository";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { configurationUpdateSchema } from "../validation/configuration.validation";
import type { z } from "zod";

export const configurationService = {
  /**
   * Retrieves the fully typed configuration payload directly from the Engine cache.
   * O(1) memory lookup. Zero database reads.
   */
  getFullConfiguration() {
    return {
      storeName: ConfigurationEngine.getStoreName(),
      currency: ConfigurationEngine.getCurrency(),
      timeZone: ConfigurationEngine.getTimeZone(),
      storeConfig: ConfigurationEngine.getStoreSettings(),
      invoiceConfig: ConfigurationEngine.getInvoiceSettings(),
      pricingConfig: ConfigurationEngine.getPricingSettings(),
      exchangeConfig: ConfigurationEngine.getExchangeSettings(),
      inventoryConfig: ConfigurationEngine.getInventorySettings(),
      securityConfig: ConfigurationEngine.getSecuritySettings(),
      reportingConfig: ConfigurationEngine.getReportingSettings(),
    };
  },

  /**
   * Validates and updates the configuration.
   * Forces the Engine to flush its cache and reload from the database.
   */
  async updateConfiguration(payload: z.infer<typeof configurationUpdateSchema>["body"], employeeId: string) {
    // We only update what was provided
    const updateData: any = {};
    if (payload.storeName) updateData.storeName = payload.storeName;
    if (payload.currency) updateData.currency = payload.currency;
    if (payload.timeZone) updateData.timeZone = payload.timeZone;
    if (payload.storeConfig) updateData.storeConfig = payload.storeConfig;
    if (payload.invoiceConfig) updateData.invoiceConfig = payload.invoiceConfig;
    if (payload.pricingConfig) updateData.pricingConfig = payload.pricingConfig;
    if (payload.exchangeConfig) updateData.exchangeConfig = payload.exchangeConfig;
    if (payload.inventoryConfig) updateData.inventoryConfig = payload.inventoryConfig;
    if (payload.securityConfig) updateData.securityConfig = payload.securityConfig;
    if (payload.reportingConfig) updateData.reportingConfig = payload.reportingConfig;

    await configurationRepository.updateSettings(updateData, employeeId);

    // FLUSH CACHE & RELOAD
    ConfigurationEngine.invalidateCache();
    await ConfigurationEngine.init(true);

    return this.getFullConfiguration();
  }
};
