import { useQueryClient } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useEffect } from "react";
import { flushOutbox } from "./queue";

// Mounted once in the root layout. Fires whenever the device transitions to
// online, AND on initial mount if it's already online -- the second case
// covers "app restarted while offline, and reconnected before or by the
// time the user reopens it," not just a live reconnect event mid-session.
export function useOutboxFlushOnReconnect(): void {
  const { isConnected, isInternetReachable } = useNetworkState();
  const queryClient = useQueryClient();
  const online = isConnected === true && isInternetReachable !== false;

  useEffect(() => {
    if (!online) return;
    void flushOutbox().then(({ flushed }) => {
      if (flushed > 0) {
        void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      }
    });
  }, [online, queryClient]);
}
