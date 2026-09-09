import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Realtime subscriptions already push fresh data on change, so aggressive
  // refetch-on-mount/refetch-on-focus (React Query's defaults) only adds
  // redundant network round trips on every navigation and tab switch. A
  // short staleTime lets cached data serve instantly while still catching
  // anything a realtime event missed.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
