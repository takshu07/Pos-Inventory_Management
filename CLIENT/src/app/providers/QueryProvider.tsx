import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/lib/queryClient";

/**
 * Query Provider
 * Responsibility: Injects the TanStack Query client into the React tree.
 * Why it exists: Abstracting this from App.tsx keeps the bootstrap clean and
 * allows swapping implementations without touching core logic.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Devtools only bundle in development mode automatically */}
      <ReactQueryDevtools initialIsOpen={false} position="bottom" />
    </QueryClientProvider>
  );
}
