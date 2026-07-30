/**
 * Label Engine — React Query hooks.
 *
 * Caching strategy is driven by how volatile each resource actually is:
 *   • Templates/printers/settings change rarely → long staleTime.
 *   • The QUEUE changes on its own as the worker drains it → short interval
 *     polling, but ONLY while something is actually in flight. Polling an idle
 *     queue every 2s would be pure waste on every open tab.
 *   • Previews are keyed by (variant, template) and memoised, so dragging a
 *     copies spinner never re-fetches an unchanged image.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import {
  cancelJob,
  createPrinter,
  createTemplate,
  deletePrinter,
  deleteTemplate,
  downloadLabelPdf,
  duplicateTemplate,
  fetchCapabilities,
  fetchHistory,
  fetchJob,
  fetchJobs,
  fetchPreview,
  fetchPrinters,
  fetchQueue,
  fetchQueueStats,
  fetchSettings,
  fetchTemplate,
  fetchTemplates,
  printFromSearch,
  printInventoryLabels,
  printProductLabels,
  printPurchaseLabels,
  probeAllPrinters,
  reprintJob,
  retryJob,
  setDefaultPrinter,
  submitBatchPrintJob,
  submitPrintJob,
  testPrinter,
  updatePrinter,
  updateSettings,
  updateTemplate,
  type BatchPrintParams,
  type ListJobsParams,
  type PrinterWritePayload,
  type PrinterSettings,
  type PrintJobParams,
  type TemplateWritePayload,
} from "../api/labelApi";

// ── Query keys ───────────────────────────────────────────────────────────────

export const labelKeys = {
  all: ["labels"] as const,
  preview: (params: object) => [...labelKeys.all, "preview", params] as const,
  templates: () => [...labelKeys.all, "templates"] as const,
  templateList: (params: object) => [...labelKeys.templates(), params] as const,
  template: (id: string) => [...labelKeys.templates(), id] as const,
  printers: () => [...labelKeys.all, "printers"] as const,
  printerList: (includeInactive: boolean) =>
    [...labelKeys.printers(), { includeInactive }] as const,
  capabilities: () => [...labelKeys.all, "capabilities"] as const,
  settings: () => [...labelKeys.all, "settings"] as const,
  jobs: () => [...labelKeys.all, "jobs"] as const,
  jobList: (params: object) => [...labelKeys.jobs(), params] as const,
  job: (id: string) => [...labelKeys.jobs(), id] as const,
  queue: () => [...labelKeys.all, "queue"] as const,
  queueStats: () => [...labelKeys.all, "queue", "stats"] as const,
  history: (params: object) => [...labelKeys.all, "history", params] as const,
};

/** Invalidates every queue-facing cache after a job mutation. */
function invalidateQueue(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: labelKeys.queue() });
  void queryClient.invalidateQueries({ queryKey: labelKeys.jobs() });
  void queryClient.invalidateQueries({ queryKey: labelKeys.queueStats() });
}

// ── Preview ──────────────────────────────────────────────────────────────────

/**
 * Live label preview.
 *
 * `enabled` guards the "no variant AND no sample" case so opening a dialog
 * before a product is chosen does not fire a doomed request.
 */
export function useLabelPreview(params: {
  variantId?: string | null;
  templateId?: string | null;
  sample?: boolean;
  enabled?: boolean;
}) {
  const { enabled = true, ...query } = params;

  return useQuery({
    queryKey: labelKeys.preview(query),
    queryFn: () => fetchPreview(query),
    enabled: enabled && (!!query.variantId || !!query.sample),
    // Prices can change underneath a long-open dialog, but not second to
    // second — 30s keeps it fresh without re-rendering on every keystroke.
    staleTime: 30_000,
  });
}

// ── Queue (background polling) ───────────────────────────────────────────────

/**
 * The live print queue.
 *
 * Polls only while work is in flight. An idle queue settles to no polling at
 * all, so an open tab costs nothing once the printer has caught up.
 */
export function usePrintQueue(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: labelKeys.queue(),
    queryFn: fetchQueue,
    enabled: options.enabled ?? true,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs || jobs.length === 0) return false; // idle → stop polling
      return 2000;
    },
    refetchIntervalInBackground: false,
  });
}

export function useQueueStats(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: labelKeys.queueStats(),
    queryFn: fetchQueueStats,
    enabled: options.enabled ?? true,
    refetchInterval: (query) => {
      const stats = query.state.data;
      if (!stats) return false;
      const active =
        stats.counts.QUEUED + stats.counts.PENDING + stats.counts.PRINTING;
      return active > 0 ? 2000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function usePrintJobs(
  params: ListJobsParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: labelKeys.jobList(params),
    queryFn: () => fetchJobs(params),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/**
 * A single job, polled while it is not yet terminal.
 *
 * Used by PrintJobStatus so a toast/inline indicator resolves itself without
 * the user refreshing.
 */
export function usePrintJob(jobId: string | null) {
  return useQuery({
    queryKey: labelKeys.job(jobId ?? ""),
    queryFn: () => fetchJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return false;
      const terminal =
        job.status === "COMPLETED" ||
        job.status === "FAILED" ||
        job.status === "CANCELLED";
      return terminal ? false : 1500;
    },
  });
}

export function usePrintHistory(
  params: ListJobsParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: labelKeys.history(params),
    queryFn: () => fetchHistory(params),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

// ── Print mutations ──────────────────────────────────────────────────────────

export function usePrintLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PrintJobParams) => submitPrintJob(payload),
    onSuccess: (job) => {
      // 202 Accepted — the job is queued, not printed. The message says so
      // rather than claiming a label already came out.
      toast.success(`Print job ${job.jobNumber} queued`, {
        description: `${job.totalCopies} label${job.totalCopies === 1 ? "" : "s"} sent to the print queue.`,
      });
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not queue print job", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function useBatchPrintLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: BatchPrintParams) => submitBatchPrintJob(payload),
    onSuccess: (job) => {
      toast.success(`Batch job ${job.jobNumber} queued`, {
        description: `${job.totalCopies} labels queued for printing.`,
      });
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not queue batch print", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function useReprintJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { jobId: string; reason?: string | null }) =>
      reprintJob(params.jobId, { reason: params.reason ?? null }),
    onSuccess: (job) => {
      toast.success(`Reprint queued as ${job.jobNumber}`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Reprint failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    onSuccess: (job) => {
      toast.success(`Job ${job.jobNumber} cancelled`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not cancel job", {
        description: error instanceof Error ? error.message : "The job may have already printed.",
      });
    },
  });
}

export function useRetryJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { jobId: string; printerId?: string | null }) =>
      retryJob(params.jobId, params.printerId ?? null),
    onSuccess: (job) => {
      toast.success(`Job ${job.jobNumber} re-queued`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not retry job", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

/**
 * Downloads a PDF and triggers the browser save dialog.
 *
 * The object URL is revoked after the click to avoid leaking a blob per
 * download — a batch-heavy session would otherwise accumulate them.
 */
export function useDownloadPdf() {
  return useMutation({
    mutationFn: async (payload: {
      variantIds: string[];
      templateId?: string | null;
      copies?: number;
      filename?: string;
    }) => {
      const blob = await downloadLabelPdf(payload);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = payload.filename ?? `labels-${Date.now()}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      return blob;
    },
    onSuccess: () => toast.success("Label PDF downloaded"),
    onError: () => toast.error("Could not generate the label PDF"),
  });
}

// ── Module-scoped printing ───────────────────────────────────────────────────

export function usePrintProductLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      productId: string;
      variantIds?: string[];
      copies?: number;
    }) =>
      printProductLabels(params.productId, {
        ...(params.variantIds && { variantIds: params.variantIds }),
        ...(params.copies !== undefined && { copies: params.copies }),
      }),
    onSuccess: (job) => {
      toast.success(`Product labels queued (${job.jobNumber})`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not print product labels", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function usePrintPurchaseLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { purchaseId: string; singlePerVariant?: boolean }) =>
      printPurchaseLabels(params.purchaseId, {
        ...(params.singlePerVariant !== undefined && {
          singlePerVariant: params.singlePerVariant,
        }),
      }),
    onSuccess: (job) => {
      toast.success(`Purchase labels queued (${job.jobNumber})`, {
        description: `${job.totalCopies} labels for received stock.`,
      });
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not print purchase labels", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function usePrintInventoryLabels() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: printInventoryLabels,
    onSuccess: (job) => {
      toast.success(`Inventory labels queued (${job.jobNumber})`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not print inventory labels", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function usePrintFromSearch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: printFromSearch,
    onSuccess: (job) => {
      toast.success(`Labels queued (${job.jobNumber})`);
      invalidateQueue(queryClient);
    },
    onError: (error: unknown) => {
      toast.error("Could not print labels", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

export function useLabelTemplates(
  params: { kind?: string; includeInactive?: boolean; search?: string } = {},
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: labelKeys.templateList(params),
    queryFn: () => fetchTemplates(params as never),
    enabled: options.enabled ?? true,
    // Templates are edited rarely; a long window avoids refetching the picker
    // every time a dialog opens.
    staleTime: 5 * 60_000,
  });
}

export function useLabelTemplate(id: string | null) {
  return useQuery({
    queryKey: labelKeys.template(id ?? ""),
    queryFn: () => fetchTemplate(id as string),
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: TemplateWritePayload) => createTemplate(payload),
    onSuccess: (result) => {
      toast.success(`Template "${result.template.name}" created`);
      for (const warning of result.warnings) {
        toast.warning(warning.message);
      }
      void queryClient.invalidateQueries({ queryKey: labelKeys.templates() });
    },
    onError: (error: unknown) => {
      toast.error("Could not save template", {
        description: error instanceof Error ? error.message : "Please check the layout.",
      });
    },
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { id: string; payload: TemplateWritePayload }) =>
      updateTemplate(params.id, params.payload),
    onSuccess: (result) => {
      toast.success(`Template "${result.template.name}" updated`);
      for (const warning of result.warnings) {
        toast.warning(warning.message);
      }
      void queryClient.invalidateQueries({ queryKey: labelKeys.templates() });
      // A changed layout invalidates every cached preview.
      void queryClient.invalidateQueries({ queryKey: [...labelKeys.all, "preview"] });
    },
    onError: (error: unknown) => {
      toast.error("Could not update template", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function useDuplicateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { id: string; name?: string }) =>
      duplicateTemplate(params.id, params.name),
    onSuccess: (template) => {
      toast.success(`Duplicated as "${template.name}"`);
      void queryClient.invalidateQueries({ queryKey: labelKeys.templates() });
    },
    onError: () => toast.error("Could not duplicate template"),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: (result) => {
      toast.success(
        result.deleted
          ? "Template deleted"
          : "Template deactivated (it is referenced by print history)"
      );
      void queryClient.invalidateQueries({ queryKey: labelKeys.templates() });
    },
    onError: (error: unknown) => {
      toast.error("Could not delete template", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

// ── Printers ─────────────────────────────────────────────────────────────────

export function usePrinters(
  includeInactive = false,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: labelKeys.printerList(includeInactive),
    queryFn: () => fetchPrinters(includeInactive),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

export function usePrinterCapabilities(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: labelKeys.capabilities(),
    queryFn: fetchCapabilities,
    enabled: options.enabled ?? true,
    // Driver/transport lists change only on deploy.
    staleTime: Infinity,
  });
}

export function useCreatePrinter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: PrinterWritePayload) => createPrinter(payload),
    onSuccess: (printer) => {
      toast.success(`Printer "${printer.name}" added`);
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
    },
    onError: (error: unknown) => {
      toast.error("Could not add printer", {
        description: error instanceof Error ? error.message : "Please check the settings.",
      });
    },
  });
}

export function useUpdatePrinter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { id: string; payload: Partial<PrinterWritePayload> }) =>
      updatePrinter(params.id, params.payload),
    onSuccess: (printer) => {
      toast.success(`Printer "${printer.name}" updated`);
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
    },
    onError: (error: unknown) => {
      toast.error("Could not update printer", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    },
  });
}

export function useDeletePrinter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deletePrinter(id),
    onSuccess: () => {
      toast.success("Printer deactivated");
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
    },
    onError: () => toast.error("Could not deactivate printer"),
  });
}

export function useSetDefaultPrinter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => setDefaultPrinter(id),
    onSuccess: (printer) => {
      toast.success(`"${printer.name}" is now the default printer`);
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
      void queryClient.invalidateQueries({ queryKey: labelKeys.settings() });
    },
    onError: () => toast.error("Could not set the default printer"),
  });
}

export function useTestPrinter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => testPrinter(id),
    onSuccess: (result) => {
      if (result.online) {
        toast.success(`"${result.printer.name}" is online`);
      } else {
        toast.warning(`"${result.printer.name}" is not reachable`, {
          description: result.error,
        });
      }
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
    },
    onError: () => toast.error("Could not reach the printer"),
  });
}

export function useProbeAllPrinters() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: probeAllPrinters,
    onSuccess: (results) => {
      const online = results.filter((r) => r.online).length;
      toast.success(`${online} of ${results.length} printers online`);
      void queryClient.invalidateQueries({ queryKey: labelKeys.printers() });
    },
    onError: () => toast.error("Could not refresh printer status"),
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function useLabelSettings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: labelKeys.settings(),
    queryFn: fetchSettings,
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useUpdateLabelSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Partial<PrinterSettings>) => updateSettings(payload),
    // Optimistic: settings toggles should feel instant. On failure we roll back
    // to the exact previous snapshot rather than guessing.
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: labelKeys.settings() });
      const previous = queryClient.getQueryData<PrinterSettings>(labelKeys.settings());
      if (previous) {
        queryClient.setQueryData<PrinterSettings>(labelKeys.settings(), {
          ...previous,
          ...payload,
        });
      }
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(labelKeys.settings(), context.previous);
      }
      toast.error("Could not save label settings");
    },
    onSuccess: () => toast.success("Label settings saved"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: labelKeys.settings() });
    },
  });
}
