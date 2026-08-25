import { describe, expect, it } from "vitest";
import {
  advanceBackfillCursor,
  BackfillTransitionError,
  clearBackfill,
  completeBackfill,
  requestBackfillCancel,
  satisfiesBackfillInvariant,
  settleBackfill,
  startBackfill,
  type BackfillState,
} from "./backfill.js";

const NOW = new Date("2026-08-24T19:00:00Z");

function state(overrides: Partial<BackfillState> = {}): BackfillState {
  return {
    backfillStatus: "idle",
    backfillTargetDate: null,
    backfillCursorDate: null,
    backfillCancelRequested: false,
    earliestVerifiedDate: null,
    ...overrides,
  };
}

describe("startBackfill", () => {
  it("walks back from earliest_verified_date when one exists", () => {
    const c = startBackfill(state({ earliestVerifiedDate: "2026-07-01" }), "2026-01-01", NOW);
    expect(c).toEqual({
      backfillStatus: "running",
      backfillTargetDate: "2026-01-01",
      backfillCursorDate: "2026-07-01",
      backfillCancelRequested: false,
    });
  });

  it("falls back to the last globally complete date when nothing is verified yet", () => {
    // 2026-08-24T19:00Z minus the 12h max lag -> 2026-08-24.
    const c = startBackfill(state(), "2026-01-01", NOW);
    expect(c.backfillCursorDate).toBe("2026-08-24");
  });

  it("clears a stale cancel flag so a restart is not immediately cancelled", () => {
    const c = startBackfill(
      state({
        backfillStatus: "cancelled",
        backfillTargetDate: "2026-02-01",
        backfillCancelRequested: true,
        earliestVerifiedDate: "2026-07-01",
      }),
      "2026-01-01",
      NOW,
    );
    expect(c.backfillCancelRequested).toBe(false);
    expect(c.backfillStatus).toBe("running");
  });

  it("restarts a completed backfill with a new, older target", () => {
    const c = startBackfill(
      state({
        backfillStatus: "complete",
        backfillTargetDate: "2026-06-01",
        backfillCursorDate: "2026-06-01",
        earliestVerifiedDate: "2026-06-01",
      }),
      "2026-01-01",
      NOW,
    );
    expect(c.backfillStatus).toBe("running");
    expect(c.backfillTargetDate).toBe("2026-01-01");
  });

  it("refuses a second concurrent run", () => {
    expect(() =>
      startBackfill(
        state({ backfillStatus: "running", backfillTargetDate: "2026-01-01" }),
        "2025-01-01",
        NOW,
      ),
    ).toThrow(BackfillTransitionError);
  });

  it("refuses a target that is not strictly older than the verified frontier", () => {
    expect(() =>
      startBackfill(state({ earliestVerifiedDate: "2026-07-01" }), "2026-07-01", NOW),
    ).toThrow(/strictly older/);
  });
});

describe("cancel / advance / complete / settle / clear", () => {
  const running = state({
    backfillStatus: "running",
    backfillTargetDate: "2026-01-01",
    backfillCursorDate: "2026-07-01",
  });

  it("requestBackfillCancel only sets the flag, leaving status running", () => {
    const c = requestBackfillCancel(running);
    expect(c.backfillCancelRequested).toBe(true);
    expect(c.backfillStatus).toBe("running");
  });

  it("requestBackfillCancel refuses when nothing is running", () => {
    expect(() => requestBackfillCancel(state())).toThrow(/no backfill is running/);
  });

  it("advanceBackfillCursor moves the exclusive upper bound backwards", () => {
    expect(advanceBackfillCursor(running, "2026-06-01").backfillCursorDate).toBe("2026-06-01");
  });

  it("completeBackfill KEEPS the target non-null (a null target there is a 23514)", () => {
    const c = completeBackfill(running);
    expect(c).toEqual({
      backfillStatus: "complete",
      backfillTargetDate: "2026-01-01",
      backfillCursorDate: "2026-01-01",
    });
    expect(c.backfillTargetDate).not.toBeNull();
    // The cancel flag is deliberately NOT written by a progress transition --
    // see BackfillProgressColumns. Writing it back from a pre-fetch snapshot
    // would silently discard a cancel that arrived during the fetch.
    expect(c).not.toHaveProperty("backfillCancelRequested");
  });

  it("settleBackfill retains both dates so the run can be resumed or inspected", () => {
    for (const s of ["cancelled", "failed", "paused"] as const) {
      const c = settleBackfill(running, s);
      expect(c.backfillStatus).toBe(s);
      expect(c.backfillTargetDate).toBe("2026-01-01");
      expect(c.backfillCursorDate).toBe("2026-07-01");
    }
  });

  it("clearBackfill is the only transition that nulls both dates", () => {
    expect(clearBackfill()).toEqual({
      backfillStatus: "idle",
      backfillTargetDate: null,
      backfillCursorDate: null,
      backfillCancelRequested: false,
    });
  });
});

describe("a progress transition never writes the cancel flag (stale-snapshot hazard)", () => {
  // Checkpoint 6.3 audit finding. A chunk snapshots stream state BEFORE its
  // network fetch. If advanceBackfillCursor/completeBackfill wrote the cancel
  // flag from that snapshot, a cancel arriving DURING the fetch would be
  // overwritten when the chunk committed -- the API having already returned
  // 200 -- and the backfill would run on forever.
  const running = state({
    backfillStatus: "running",
    backfillTargetDate: "2026-01-01",
    backfillCursorDate: "2026-07-01",
  });

  it("advanceBackfillCursor omits it even when the snapshot says false", () => {
    expect(
      advanceBackfillCursor({ ...running, backfillCancelRequested: false }, "2026-06-01"),
    ).not.toHaveProperty("backfillCancelRequested");
  });

  it("completeBackfill omits it even when the snapshot says true", () => {
    expect(completeBackfill({ ...running, backfillCancelRequested: true })).not.toHaveProperty(
      "backfillCancelRequested",
    );
  });

  it("only the transitions that own the flag write it", () => {
    expect(requestBackfillCancel(running).backfillCancelRequested).toBe(true);
    expect(settleBackfill(running, "cancelled").backfillCancelRequested).toBe(false);
    expect(
      startBackfill(state({ earliestVerifiedDate: "2026-07-01" }), "2026-01-01", NOW)
        .backfillCancelRequested,
    ).toBe(false);
    expect(clearBackfill().backfillCancelRequested).toBe(false);
  });
});

describe("every transition satisfies the database CHECK", () => {
  const running = state({
    backfillStatus: "running",
    backfillTargetDate: "2026-01-01",
    backfillCursorDate: "2026-07-01",
    earliestVerifiedDate: "2026-07-01",
  });

  it("holds for start, advance, complete, settle and clear", () => {
    expect(
      satisfiesBackfillInvariant(
        startBackfill(state({ earliestVerifiedDate: "2026-07-01" }), "2026-01-01", NOW),
      ),
    ).toBe(true);
    expect(satisfiesBackfillInvariant(requestBackfillCancel(running))).toBe(true);
    expect(satisfiesBackfillInvariant(advanceBackfillCursor(running, "2026-06-01"))).toBe(true);
    expect(satisfiesBackfillInvariant(completeBackfill(running))).toBe(true);
    expect(satisfiesBackfillInvariant(settleBackfill(running, "cancelled"))).toBe(true);
    expect(satisfiesBackfillInvariant(clearBackfill())).toBe(true);
  });

  it("catches the exact regression the CHECK exists for: idle with dates still set", () => {
    // This is what a bare `SET backfill_status = 'idle'` would produce.
    expect(
      satisfiesBackfillInvariant({
        backfillStatus: "idle",
        backfillTargetDate: "2026-01-01",
        backfillCursorDate: "2026-07-01",
      }),
    ).toBe(false);
  });

  it("catches a non-idle status with a null target", () => {
    expect(
      satisfiesBackfillInvariant({
        backfillStatus: "complete",
        backfillTargetDate: null,
        backfillCursorDate: null,
      }),
    ).toBe(false);
  });
});
