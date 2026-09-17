// The chip tone for each Health connection state (Checkpoint 10.3).
//
// A pure mapping, kept out of the components so it can be pinned by a test
// without rendering. connection-card.tsx's copy already decides whether a
// state is one the user must act on (`warning`) or not (`neutral`); this
// narrows the neutral side further so the ONE healthy state reads green and
// the in-flight one blue, while every state that asserts nothing -- the API
// is unreachable, nothing is configured, nothing is connected, the last run
// failed for a cause we structurally cannot name -- stays neutral. A red
// tone is never used here: nothing on this card is an error the user caused.
import type { ChipTone } from "@/components/ui";
import type { HealthConnectionDisplayState } from "./connection-state";

export function healthConnectionChipTone(state: HealthConnectionDisplayState): ChipTone {
  switch (state) {
    case "current":
      return "success";
    case "syncing":
      return "info";
    case "needs_reconnect":
    case "no_streams_enabled":
    case "partial_scope":
    case "stale":
      return "warning";
    case "unavailable":
    case "not_configured":
    case "not_connected":
    case "error":
      return "neutral";
  }
}
