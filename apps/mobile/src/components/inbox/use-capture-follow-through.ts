import type { InboxItem } from "@personal-os/schema";
import { useEffect, useRef, useState } from "react";
import { api } from "@/queries/client";
import {
  FOLLOW_THROUGH_RESULT_VISIBLE_MS,
  followCaptureThrough,
  type FollowThroughOutcome,
} from "./capture-follow-through";

// The stateful half of D3-lite (see capture-follow-through.ts for the
// bounded, pure poll). Split into a CONTROLLER -- plain functions over
// injected fetch/sleep/timer/emit -- and a thin hook, because this repo has
// no React renderer for tests: the controller is what the tests drive, and
// the hook only wires it to useState and the real api/setTimeout.

export type FollowThroughState =
  | { phase: "filing"; inboxId: string }
  | { phase: "settled"; outcome: Exclude<FollowThroughOutcome, { kind: "unresolved" }> };

export interface FollowThroughControllerDeps {
  fetchItem: (inboxId: string) => Promise<InboxItem>;
  sleep: (ms: number) => Promise<void>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  emit: (state: FollowThroughState | null) => void;
}

export interface FollowThroughController {
  /** Begin following a freshly-sent capture; supersedes any run in progress. */
  start: (inboxId: string) => void;
  /** Clear the banner (a tap, or a cancel); ends any run in progress. */
  dismiss: () => void;
  /** Unmount: stop everything, emit nothing further. */
  dispose: () => void;
}

export function createFollowThroughController(
  deps: FollowThroughControllerDeps,
): FollowThroughController {
  // A monotonically increasing run id. Every async continuation checks it
  // against the id it was started with, so a superseded run (a second
  // capture sent while the first is still filing) can neither overwrite the
  // newer banner nor clear it early.
  let runId = 0;
  let hideTimer: unknown = null;

  const cancelHide = () => {
    if (hideTimer !== null) {
      deps.clearTimer(hideTimer);
      hideTimer = null;
    }
  };

  return {
    start(inboxId) {
      runId += 1;
      const id = runId;
      cancelHide();
      deps.emit({ phase: "filing", inboxId });
      void followCaptureThrough(inboxId, {
        fetchItem: deps.fetchItem,
        sleep: deps.sleep,
        isCancelled: () => runId !== id,
      }).then((outcome) => {
        if (runId !== id) return;
        if (outcome.kind === "unresolved") {
          // Nothing after the bound: the capture is on the Inbox tab.
          deps.emit(null);
          return;
        }
        deps.emit({ phase: "settled", outcome });
        hideTimer = deps.setTimer(() => {
          hideTimer = null;
          if (runId === id) deps.emit(null);
        }, FOLLOW_THROUGH_RESULT_VISIBLE_MS);
      });
    },
    dismiss() {
      runId += 1;
      cancelHide();
      deps.emit(null);
    },
    dispose() {
      runId += 1;
      cancelHide();
    },
  };
}

export function useCaptureFollowThrough(): {
  state: FollowThroughState | null;
  start: (inboxId: string) => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<FollowThroughState | null>(null);
  const controller = useRef<FollowThroughController | null>(null);
  if (controller.current === null) {
    controller.current = createFollowThroughController({
      fetchItem: (inboxId) => api.getInboxItem(inboxId),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      emit: setState,
    });
  }
  useEffect(() => () => controller.current?.dispose(), []);
  return {
    state,
    start: (inboxId) => controller.current?.start(inboxId),
    dismiss: () => controller.current?.dismiss(),
  };
}
