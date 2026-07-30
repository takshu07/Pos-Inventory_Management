/**
 * Label Engine — public barrel.
 *
 * Other features import from "@/features/labels", never from individual files.
 * That keeps the internal structure free to change and makes the integration
 * surface obvious: a module that wants label printing needs LabelToolbar (or
 * PrintDialog/BatchPrintDialog) and nothing else.
 */

// ── Components ───────────────────────────────────────────────────────────────
export { BarcodeRenderer } from "./components/BarcodeRenderer";
export { LabelCanvas } from "./components/LabelCanvas";
export { LabelPreview } from "./components/LabelPreview";
export { LabelTemplateSelector } from "./components/LabelTemplateSelector";
export { LabelTemplateTable } from "./components/LabelTemplateTable";
export { LabelToolbar } from "./components/LabelToolbar";
export { PrintDialog } from "./components/PrintDialog";
export { BatchPrintDialog, BatchPrintButton } from "./components/BatchPrintDialog";
export { PrintQueueTable } from "./components/PrintQueueTable";
export { PrintHistoryTable } from "./components/PrintHistoryTable";
export { PrintJobDetailsDrawer } from "./components/PrintJobDetailsDrawer";
export {
  PrintJobStatusBadge,
  PrintJobTracker,
} from "./components/PrintJobStatus";
export { PrinterManagementTable } from "./components/PrinterManagementTable";
export { PrinterSelector } from "./components/PrinterSelector";
export { PrinterSettings } from "./components/PrinterSettings";
export { PrinterStatus } from "./components/PrinterStatus";

export type { LabelPreviewProps } from "./components/LabelPreview";
export type { LabelToolbarProps } from "./components/LabelToolbar";
export type { PrintDialogProps, PrintDialogVariant } from "./components/PrintDialog";
export type { BatchPrintDialogProps } from "./components/BatchPrintDialog";

// ── Hooks ────────────────────────────────────────────────────────────────────
export {
  labelKeys,
  useBatchPrintLabels,
  useCancelJob,
  useCreatePrinter,
  useCreateTemplate,
  useDeletePrinter,
  useDeleteTemplate,
  useDownloadPdf,
  useDuplicateTemplate,
  useLabelPreview,
  useLabelSettings,
  useLabelTemplate,
  useLabelTemplates,
  usePrintFromSearch,
  usePrintHistory,
  usePrintInventoryLabels,
  usePrintJob,
  usePrintJobs,
  usePrintLabels,
  usePrintProductLabels,
  usePrintPurchaseLabels,
  usePrintQueue,
  usePrinterCapabilities,
  usePrinters,
  useProbeAllPrinters,
  useQueueStats,
  useReprintJob,
  useRetryJob,
  useSetDefaultPrinter,
  useTestPrinter,
  useUpdateLabelSettings,
  useUpdatePrinter,
  useUpdateTemplate,
} from "./hooks/useLabels";

export { usePrintPreferences } from "./hooks/usePrintPreferences";

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  BarcodeSymbology,
  LabelElement,
  LabelTemplate,
  LabelTemplateKind,
  Printer,
  PrinterConnectionType,
  PrinterDriverType,
  PrinterSettings as PrinterSettingsData,
  PrintJob,
  PrintJobItem,
  PrintJobStatus,
  PrintOutputMode,
  PrintSourceModule,
} from "./api/labelApi";
