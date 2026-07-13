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
      retry: (failureCount, error) => {
        // Don't retry 401/403/404 errors
        if (error instanceof Error && error.message.includes("40")) return false;
        return failureCount < 2; // Retry network failures twice
      },
      refetchOnWindowFocus: false, // Prevents aggressive background fetching in POS
    },
    mutations: {
      retry: false, // Never automatically retry mutations (e.g., checkout/payment) to avoid duplicates
    },
  },
});
