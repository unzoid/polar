import { QueryClient } from "@tanstack/react-query";
import { onSaveFailure } from "../errors";
import { keys } from "./queryKeys";

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

// A command that couldn't save still changed what the native side holds in memory: read it again,
// so the screen shows what the app has rather than what it had before the change.
const LOCAL_DATA = [keys.library, keys.progressAll, keys.continue, keys.history, keys.settings, keys.addons, keys.animeLinks];
onSaveFailure(() => LOCAL_DATA.forEach((queryKey) => queryClient.invalidateQueries({ queryKey })));
