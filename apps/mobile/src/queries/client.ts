import { createApiClient } from "@personal-os/api-client";
import { QueryClient } from "@tanstack/react-query";

// EXPO_PUBLIC_* vars are inlined into the bundle at build/dev time by
// Expo's Metro config (see apps/mobile/.env for the local-dev default).
const API_URL = process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3000";

export const api = createApiClient(API_URL);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A single-user, low-write-volume app doesn't need aggressive
      // background refetching; refetch-on-focus is enough to pick up
      // changes made from another device/tab.
      staleTime: 30_000,
    },
  },
});
