import { describe, expect, it } from "vitest";
import { resolveSeriesAnchor } from "./series-anchor.js";

const DUE = new Date("2026-09-01T14:00:00.000Z");
const EARLIEST = new Date("2026-08-15T14:00:00.000Z");
const NOW = new Date("2026-09-14T15:00:00.000Z");

describe("resolveSeriesAnchor", () => {
  it("prefers due_at over everything", () => {
    expect(resolveSeriesAnchor({ dueAt: DUE, earliestOccursAt: EARLIEST, now: NOW })).toEqual(DUE);
    expect(resolveSeriesAnchor({ dueAt: DUE, earliestOccursAt: null, now: NOW })).toEqual(DUE);
  });

  it("falls back to the earliest existing occurrence when due_at is null", () => {
    expect(resolveSeriesAnchor({ dueAt: null, earliestOccursAt: EARLIEST, now: NOW })).toEqual(
      EARLIEST,
    );
  });

  it("falls back to now only when there is neither a due date nor an occurrence", () => {
    expect(resolveSeriesAnchor({ dueAt: null, earliestOccursAt: null, now: NOW })).toEqual(NOW);
  });

  // 9.4 review: a ms-bearing anchor makes the first expanded (whole-second)
  // occurrence sort BEFORE the anchor and get dropped by the window's
  // now-floor. `now` is the input that is practically never a whole second.
  it("floors the returned instant to a whole second, whichever input wins", () => {
    const nowWithMs = new Date("2026-09-14T15:00:00.750Z");
    expect(
      resolveSeriesAnchor({ dueAt: null, earliestOccursAt: null, now: nowWithMs }).toISOString(),
    ).toBe("2026-09-14T15:00:00.000Z");
    expect(
      resolveSeriesAnchor({
        dueAt: new Date("2026-09-01T14:00:00.999Z"),
        earliestOccursAt: null,
        now: NOW,
      }).toISOString(),
    ).toBe("2026-09-01T14:00:00.000Z");
    expect(
      resolveSeriesAnchor({
        dueAt: null,
        earliestOccursAt: new Date("2026-08-15T14:00:00.001Z"),
        now: NOW,
      }).toISOString(),
    ).toBe("2026-08-15T14:00:00.000Z");
  });

  it("returns a fresh Date rather than the caller's object", () => {
    const anchor = resolveSeriesAnchor({ dueAt: DUE, earliestOccursAt: null, now: NOW });
    expect(anchor).not.toBe(DUE);
    expect(anchor.getTime()).toBe(DUE.getTime());
  });

  it("does not re-anchor an existing series on a later now", () => {
    // The whole point: the nightly job and PATCH must agree with the row the
    // route materialised, not drift to whenever they happen to run.
    const later = new Date("2027-01-01T00:00:00.000Z");
    expect(resolveSeriesAnchor({ dueAt: null, earliestOccursAt: EARLIEST, now: later })).toEqual(
      EARLIEST,
    );
  });

  it("rejects an invalid instant", () => {
    expect(() =>
      resolveSeriesAnchor({ dueAt: new Date("nope"), earliestOccursAt: null, now: NOW }),
    ).toThrow(/invalid instant/);
    expect(() =>
      resolveSeriesAnchor({ dueAt: null, earliestOccursAt: null, now: new Date("nope") }),
    ).toThrow(/invalid instant/);
  });
});
