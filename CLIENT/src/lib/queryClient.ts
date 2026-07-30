import { QueryClient } from "@tanstack/react-query";

/**
 * Global TanStack Query Client
 * Responsibility: Configures stale times, caching, and retry logic for all API queries.
 * Why it exists: Prevents UI from making excessive network requests. Configures
 * enterprise defaults (e.g., retrying 5xx errors but not 4xx errors).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // Data is fresh for 5 minutes
      gcTime: 1000 * 60 * 30, // Keep inactive data in cache for 30 minutes

      /**
       * Retry only what retrying can actually fix: network blips and 5xx.
       *
       * A 4xx means the server understood us and said no — the same request will
       * be refused identically, so retrying just makes the user wait ~2x longer
       * to see an error they were always going to get.
       *
       * This reads the real `status` that the axios response interceptor attaches
       * to every rejection (see lib/api/axios.ts). It previously tested
       * `error.message.includes("40")`, which matched on the message TEXT and so
       * caught unrelated errors — "Timeout of 15000ms" and any message mentioning
       * a quantity or price containing "40" were treated as client errors and
       * never retried, while a genuine 401 whose message didn't happen to contain
       * those digits was retried twice for nothing.
       */
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2; // Retry network failures and 5xx twice
      },
      refetchOnWindowFocus: false, // Prevents aggressive background fetching in POS
    },
    mutations: {
      retry: false, // Never automatically retry mutations (e.g., checkout/payment) to avoid duplicates
    },
  },
});
