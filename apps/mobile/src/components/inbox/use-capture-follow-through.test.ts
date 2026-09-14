import type { InboxItem } from "@personal-os/schema";
import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_THROUGH_MAX_POLLS,
  FOLLOW_THROUGH_RESULT_VISIBLE_MS,
} from "./capture-follow-through";
import { createFollowThroughController, type FollowThroughState } from "./use-capture-follow-through";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "33333333-3333-4333-8333-333333333333";
const ENTITY = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ID,
    client_uuid: null,
    raw_text: "x",
    source: "web",
    captured_at: "2026-09-13T00:00:00.000Z",
    timezone: "UTC",
    status: "pending",
    parse_result: null,
    confidence: null,
    entity_type: null,
    entity_id: null,
    archived_at: null,
    created_at: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

const FILED = item({ status: "parsed", entity_type: "note", entity_id: ENTITY });

// A deterministic harness: `sleep` resolves on the next microtask, timers are
// recorded rather than scheduled, and every emitted state is captured.
function harness(fetchItem: (id: string) => Promise<InboxItem>) {
  const states: (FollowThroughState | null)[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const controller = createFollowThroughController({
    fetchItem,
    sleep: () => Promise.resolve(),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    emit: (s) => states.push(s),
  });
  return { controller, states, timers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createFollowThroughController", () => {
  it("emits filing, then the settled outcome, then clears itself after the visible window", async () => {
    const { controller, states, timers } = harness(async () => FILED);
    controller.start(ID);
    expect(states).toEqual([{ phase: "filing", inboxId: ID }]);
    await settle();
    expect(states[1]).toEqual({
      phase: "settled",
      outcome: { kind: "filed", entityType: "note", route: `/notes/${ENTITY}`, title: null },
    });
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(FOLLOW_THROUGH_RESULT_VISIBLE_MS);
    timers[0]!.fn();
    expect(states[2]).toBeNull();
  });

  it("shows nothing after the bound when the capture never settles", async () => {
    const fetchItem = vi.fn(async () => item({ status: "pending" }));
    const { controller, states, timers } = harness(fetchItem);
    controller.start(ID);
    await settle();
    expect(fetchItem).toHaveBeenCalledTimes(FOLLOW_THROUGH_MAX_POLLS);
    expect(states).toEqual([{ phase: "filing", inboxId: ID }, null]);
    expect(timers).toHaveLength(0);
  });

  it("a second capture supersedes the first: the stale run can neither overwrite nor clear the banner", async () => {
    let releaseFirst: (value: InboxItem) => void = () => {};
    const first = new Promise<InboxItem>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchItem = vi.fn((id: string) =>
      id === ID ? first : Promise.resolve({ ...FILED, id: ID2 }),
    );
    const { controller, states } = harness(fetchItem);
    controller.start(ID);
    // Let the first run get past its sleep and into its (hanging) fetch.
    await settle();
    expect(fetchItem).toHaveBeenCalledWith(ID);
    controller.start(ID2);
    await settle();
    expect(states.at(-1)).toMatchObject({ phase: "settled" });
    const settledCount = states.length;
    // Now the first run's fetch resolves as a needs_confirm -- and is ignored.
    releaseFirst(item({ status: "needs_confirm" }));
    await settle();
    expect(states).toHaveLength(settledCount);
  });

  it("dismiss clears the banner and cancels the pending hide timer", async () => {
    const { controller, states, timers } = harness(async () => FILED);
    controller.start(ID);
    await settle();
    controller.dismiss();
    expect(states.at(-1)).toBeNull();
    expect(timers[0]!.cleared).toBe(true);
    // A late hide-timer callback from the dismissed run emits nothing more.
    const count = states.length;
    timers[0]!.fn();
    expect(states).toHaveLength(count);
  });

  it("dispose stops a run in flight without emitting into an unmounted component", async () => {
    const fetchItem = vi.fn(async () => FILED);
    const { controller, states } = harness(fetchItem);
    controller.start(ID);
    controller.dispose();
    await settle();
    expect(states).toEqual([{ phase: "filing", inboxId: ID }]);
    expect(fetchItem).not.toHaveBeenCalled();
  });
});
