/**
 * Cash Register — React Query bindings.
 *
 * THE LIVE DASHBOARD POLLS. Everything else does not.
 *
 * A drawer changes while a cashier is looking at it — every sale their
 * colleague rings up on the same session moves the expected balance. A stale
 * expected figure is not a cosmetic problem here: it is the number the cashier
 * counts against at close. So the live query refetches on an interval and on
 * window focus, and every mutation invalidates it.
 *
 * History, drops and payouts are historical records and are cached normally.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";

import * as api from "../api/registerApi";
import type {
  AdjustmentPayload,
  CashDropPayload,
  CashPayoutPayload,
  CloseRegisterPayload,
  DropListParams,
  LiveDashboard,
  OpenRegisterPayload,
  PayoutListParams,
  RegisterHistoryParams,
} from "../types";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const registerKeys = {
  all: ["register"] as const,
  live: (registerId?: string) => [...registerKeys.all, "live", registerId ?? "own"] as const,
  numbers: () => [...registerKeys.all, "numbers"] as const,
  history: (params: RegisterHistoryParams) => [...registerKeys.all, "history", params] as const,
  drops: (params: DropListParams) => [...registerKeys.all, "drops", params] as const,
  payouts: (params: PayoutListParams) => [...registerKeys.all, "payouts", params] as const,
  summary: (id: string) => [...registerKeys.all, "summary", id] as const,
  closePreview: (id: string) => [...registerKeys.all, "close-preview", id] as const,
  activity: (id: string, params: object) => [...registerKeys.all, "activity", id, params] as const,
};

/** Errors arrive from the axios interceptor already normalised to a message. */
function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
  return anyErr?.response?.data?.message ?? anyErr?.message ?? fallback;
}

// =============================================================================
// LIVE DRAWER
// =============================================================================

/**
 * The cashier's shift dashboard.
 *
 * `refetchInterval` is 20s — frequent enough that the expected balance is
 * never meaningfully stale, infrequent enough that an idle till is not
 * hammering the database all day. Also refetches on focus, which covers the
 * common case of a cashier switching back from the POS tab.
 */
export function useLiveRegister(
  registerId?: string,
  options?: Partial<UseQueryOptions<LiveDashboard>>
) {
  return useQuery<LiveDashboard>({
    queryKey: registerKeys.live(registerId),
    queryFn: () => api.fetchLiveDashboard(registerId),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    ...options,
  });
}

export function useRegisterNumbers() {
  return useQuery({
    queryKey: registerKeys.numbers(),
    queryFn: api.fetchRegisterNumbers,
    // Till identifiers essentially never change within a session.
    staleTime: 10 * 60_000,
  });
}

// =============================================================================
// LISTS
// =============================================================================

export function useRegisterHistory(params: RegisterHistoryParams) {
  return useQuery({
    queryKey: registerKeys.history(params),
    queryFn: () => api.fetchRegisterHistory(params),
    staleTime: 30_000,
  });
}

export function useCashDrops(params: DropListParams) {
  return useQuery({
    queryKey: registerKeys.drops(params),
    queryFn: () => api.fetchCashDrops(params),
    staleTime: 30_000,
  });
}

export function useCashPayouts(params: PayoutListParams) {
  return useQuery({
    queryKey: registerKeys.payouts(params),
    queryFn: () => api.fetchCashPayouts(params),
    staleTime: 30_000,
  });
}

export function useShiftSummary(registerId: string | undefined) {
  return useQuery({
    queryKey: registerKeys.summary(registerId ?? ""),
    queryFn: () => api.fetchShiftSummary(registerId!),
    enabled: Boolean(registerId),
  });
}

export function useSessionActivity(
  registerId: string | undefined,
  params: { page?: number; limit?: number; type?: string }
) {
  return useQuery({
    queryKey: registerKeys.activity(registerId ?? "", params),
    queryFn: () => api.fetchSessionActivity(registerId!, params),
    enabled: Boolean(registerId),
  });
}

/**
 * The close dialog's expected figure.
 *
 * `staleTime: 0` deliberately. This number is what the cashier signs off
 * against; serving it from cache could show a figure from before the last sale,
 * which is exactly the mismatch the server's `expectedCashAtSubmit` guard would
 * then reject — better to be right than to be fast here.
 */
export function useClosePreview(registerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: registerKeys.closePreview(registerId ?? ""),
    queryFn: () => api.fetchClosePreview(registerId!),
    enabled: Boolean(registerId) && enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Invalidates everything a drawer mutation can affect.
 *
 * Broad on purpose: a drop changes the live position, the drop list, the
 * session's activity timeline and its summary. Enumerating each key per
 * mutation is how one of them eventually gets forgotten and a screen shows a
 * figure that no longer exists.
 */
function useInvalidateRegister() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: registerKeys.all });
}

export function useOpenRegister() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: (payload: OpenRegisterPayload) => api.openRegister(payload),
    onSuccess: (session) => {
      void invalidate();
      toast.success(`Register ${session.registerNumber} opened.`);
    },
    onError: (err) =>
      toast.error(errorMessage(err, "Could not open the register.")),
  });
}

export function useCloseRegister() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, payload }: { registerId: string; payload: CloseRegisterPayload }) =>
      api.closeRegister(registerId, payload),
    onSuccess: (result) => {
      void invalidate();
      if (result.variance.difference === 0) {
        toast.success("Register closed and balanced.");
      } else {
        const kind = result.variance.difference > 0 ? "over" : "short";
        toast.warning(
          `Register closed — drawer is ${kind} by ₹${Math.abs(result.variance.difference).toFixed(2)}.`
        );
      }
    },
    onError: (err) => toast.error(errorMessage(err, "Could not close the register.")),
  });
}

export function useReconcileRegister() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, notes }: { registerId: string; notes?: string }) =>
      api.reconcileRegister(registerId, notes),
    onSuccess: () => {
      void invalidate();
      toast.success("Shift reconciled.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not reconcile the shift.")),
  });
}

export function useCreateCashDrop() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, payload }: { registerId: string; payload: CashDropPayload }) =>
      api.createCashDrop(registerId, payload),
    onSuccess: (drop) => {
      void invalidate();
      toast.success(`Cash drop ${drop.dropNumber} recorded.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the cash drop.")),
  });
}

export function useCreateCashPayout() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, payload }: { registerId: string; payload: CashPayoutPayload }) =>
      api.createCashPayout(registerId, payload),
    onSuccess: (payout) => {
      void invalidate();
      toast.success(`Payout ${payout.payoutNumber} recorded.`);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record the payout.")),
  });
}

export function useCreateAdjustment() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, payload }: { registerId: string; payload: AdjustmentPayload }) =>
      api.createAdjustment(registerId, payload),
    onSuccess: () => {
      void invalidate();
      toast.success("Drawer adjustment posted.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not post the adjustment.")),
  });
}

export function useAddRegisterNote() {
  const invalidate = useInvalidateRegister();

  return useMutation({
    mutationFn: ({ registerId, note }: { registerId: string; note: string }) =>
      api.addRegisterNote(registerId, note),
    onSuccess: () => {
      void invalidate();
      toast.success("Note added to the shift timeline.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not add the note.")),
  });
}
