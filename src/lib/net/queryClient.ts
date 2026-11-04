import { QueryClient } from "@tanstack/react-query";

/** The app's one query cache. On its own so lib modules that run without a window (and their tests) can use it. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
