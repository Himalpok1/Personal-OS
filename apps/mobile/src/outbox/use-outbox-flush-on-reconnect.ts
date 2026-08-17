import { useQueryClient } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useCallback, useEffect } from "react";
import { AppState, Platform } from "react-native";
import { flushOutbox } from "./queue";

const FLUSH_INTERVAL_MS = 15_000;

export function useOutboxFlushOnReconnect(): void {
  const { isConnected, isInternetReachable } = useNetworkState();
  const queryClient = useQueryClient();

  const runFlush = useCallback((ignoreBackoff = false) => {
    // Reachability probes describe public internet access, not whether the
    // private Tailscale API is reachable. The HTTP attempt is authoritative;
    // the durable outbox's persisted backoff bounds attempts while offline.
    void flushOutbox({ ignoreBackoff })
      .then(({ flushed }) => {
        void queryClient.invalidateQueries({ queryKey: ["outbox"] });
        if (flushed > 0) {
          void queryClient.invalidateQueries({ queryKey: ["inbox"] });
        }
      })
      .catch((error: unknown) => {
        console.warn("Outbox flush failed", error);
      });
  }, [queryClient]);

  useEffect(() => {
    // A connectivity transition bypasses an old offline backoff so a newly
    // reachable private API is tried immediately. This also makes the first
    // mount after process restart attempt every persisted capture once.
    runFlush(true);
    const interval = setInterval(() => runFlush(), FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isConnected, isInternetReachable, runFlush]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") runFlush(true);
    });
    return () => subscription.remove();
  }, [runFlush]);
}
