import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectNextOccurrence, type NextOccurrenceCandidate } from "./next-occurrence.js";

const NOW = new Date("2026-09-14T15:00:00.000Z");

function occ(
  id: string,
  occurs_at: string,
  status = "scheduled",
  snoozed_until: string | null = null,
): NextOccurrenceCandidate {
  return { id, occurs_at, status, snoozed_until };
}

describe("client-safety of the next-occurrence module", () => {
  it("has no imports at all", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./next-occurrence.ts", import.meta.url)),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/createRequire|node:|require\(/);
  });
});

describe("selectNextOccurrence", () => {
  it("returns null with no candidates or no scheduled candidates", () => {
    expect(selectNextOccurrence([], NOW)).toBeNull();
    expect(
      selectNextOccurrence(
        [
          occ("a", "2026-09-15T14:00:00.000Z", "done"),
          occ("b", "2026-09-16T14:00:00.000Z", "skipped"),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("picks the earliest scheduled occurrence at or after now", () => {
    const result = selectNextOccurrence(
      [
        occ("later", "2026-09-20T14:00:00.000Z"),
        occ("next", "2026-09-15T14:00:00.000Z"),
        occ("done", "2026-09-14T14:00:00.000Z", "done"),
      ],
      NOW,
    );
    expect(result).toEqual({
      id: "next",
      effective_at: "2026-09-15T14:00:00.000Z",
      overdue: false,
      snoozed: false,
    });
  });

  it("an occurrence exactly at now is upcoming, not overdue", () => {
    const result = selectNextOccurrence([occ("now", NOW.toISOString())], NOW);
    expect(result).toMatchObject({ id: "now", overdue: false });
  });

  it("returns the overdue occurrence when it is the earliest, never an upcoming one over it (9.4 review)", () => {
    // The current instance is the earliest open one, full stop: the owner
    // has to deal with the overdue row before the next, and Today lists it.
    const result = selectNextOccurrence(
      [occ("overdue", "2026-09-10T14:00:00.000Z"), occ("upcoming", "2026-09-15T14:00:00.000Z")],
      NOW,
    );
    expect(result).toEqual({
      id: "overdue",
      effective_at: "2026-09-10T14:00:00.000Z",
      overdue: true,
      snoozed: false,
    });
  });

  it("returns the EARLIEST overdue occurrence, flagged overdue, when several are overdue", () => {
    const result = selectNextOccurrence(
      [occ("recent", "2026-09-13T14:00:00.000Z"), occ("oldest", "2026-09-01T14:00:00.000Z")],
      NOW,
    );
    expect(result).toEqual({
      id: "oldest",
      effective_at: "2026-09-01T14:00:00.000Z",
      overdue: true,
      snoozed: false,
    });
  });

  it("uses snoozed_until as the effective instant and flags snoozed", () => {
    // Originally due yesterday, snoozed to tomorrow: it is upcoming at the
    // snooze instant, not overdue at occurs_at.
    const result = selectNextOccurrence(
      [
        occ("snoozed", "2026-09-13T14:00:00.000Z", "scheduled", "2026-09-15T14:00:00.000Z"),
        occ("plain", "2026-09-16T14:00:00.000Z"),
      ],
      NOW,
    );
    expect(result).toEqual({
      id: "snoozed",
      effective_at: "2026-09-15T14:00:00.000Z",
      overdue: false,
      snoozed: true,
    });
  });

  it("a snooze that has itself passed makes the row overdue at the snooze instant", () => {
    const result = selectNextOccurrence(
      [occ("snoozed", "2026-09-01T14:00:00.000Z", "scheduled", "2026-09-14T14:00:00.000Z")],
      NOW,
    );
    expect(result).toEqual({
      id: "snoozed",
      effective_at: "2026-09-14T14:00:00.000Z",
      overdue: true,
      snoozed: true,
    });
  });

  it("a snooze may only DEFER: snoozed_until earlier than occurs_at leaves the row at occurs_at, not snoozed (9.4 review)", () => {
    // The server's read models use greatest(snoozed_until, occurs_at) for the
    // same reason; the two must agree on which instant the row is due at.
    const result = selectNextOccurrence(
      [
        occ("stale-snooze", "2026-09-16T14:00:00.000Z", "scheduled", "2026-09-15T14:00:00.000Z"),
        occ("plain", "2026-09-17T14:00:00.000Z"),
      ],
      NOW,
    );
    expect(result).toEqual({
      id: "stale-snooze",
      effective_at: "2026-09-16T14:00:00.000Z",
      overdue: false,
      snoozed: false,
    });
  });

  it("a snooze equal to occurs_at is not a snooze", () => {
    const at = "2026-09-16T14:00:00.000Z";
    expect(selectNextOccurrence([occ("eq", at, "scheduled", at)], NOW)).toMatchObject({
      effective_at: at,
      snoozed: false,
    });
  });

  it("a deferring snooze can move a row BEHIND another so the other becomes next", () => {
    // Row a was first; snoozed past row b, so b is now the current instance.
    const result = selectNextOccurrence(
      [
        occ("a", "2026-09-15T14:00:00.000Z", "scheduled", "2026-09-18T14:00:00.000Z"),
        occ("b", "2026-09-16T14:00:00.000Z"),
      ],
      NOW,
    );
    expect(result).toMatchObject({ id: "b", snoozed: false });
  });

  it("an overdue snoozed row beats a later plain row, by effective instant", () => {
    const result = selectNextOccurrence(
      [
        occ("snoozed", "2026-09-01T14:00:00.000Z", "scheduled", "2026-09-14T14:00:00.000Z"),
        occ("plain", "2026-09-16T14:00:00.000Z"),
      ],
      NOW,
    );
    expect(result).toEqual({
      id: "snoozed",
      effective_at: "2026-09-14T14:00:00.000Z",
      overdue: true,
      snoozed: true,
    });
  });

  it("an unparseable snoozed_until is ignored rather than dropping the row", () => {
    const result = selectNextOccurrence(
      [occ("x", "2026-09-15T14:00:00.000Z", "scheduled", "not a date")],
      NOW,
    );
    expect(result).toMatchObject({
      id: "x",
      effective_at: "2026-09-15T14:00:00.000Z",
      snoozed: false,
    });
  });

  it("ignores snoozed_until on terminal rows", () => {
    expect(
      selectNextOccurrence(
        [occ("done", "2026-09-13T14:00:00.000Z", "done", "2026-09-15T14:00:00.000Z")],
        NOW,
      ),
    ).toBeNull();
  });

  it("treats a missing snoozed_until field as not snoozed", () => {
    const result = selectNextOccurrence(
      [{ id: "x", occurs_at: "2026-09-15T14:00:00.000Z", status: "scheduled" }],
      NOW,
    );
    expect(result).toMatchObject({ id: "x", snoozed: false });
  });

  it("breaks an exact tie on id ascending (total order)", () => {
    const at = "2026-09-15T14:00:00.000Z";
    expect(selectNextOccurrence([occ("b", at), occ("a", at), occ("c", at)], NOW)?.id).toBe("a");
    const past = "2026-09-01T14:00:00.000Z";
    expect(selectNextOccurrence([occ("b", past), occ("a", past)], NOW)?.id).toBe("a");
  });

  it("is order-independent", () => {
    const items = [
      occ("c", "2026-09-17T14:00:00.000Z"),
      occ("a", "2026-09-15T14:00:00.000Z"),
      occ("b", "2026-09-16T14:00:00.000Z"),
    ];
    expect(selectNextOccurrence(items, NOW)?.id).toBe("a");
    expect(selectNextOccurrence([...items].reverse(), NOW)?.id).toBe("a");
  });

  it("normalises effective_at to canonical ISO and skips unparseable instants", () => {
    const result = selectNextOccurrence(
      [occ("offset", "2026-09-15T09:00:00-05:00"), occ("bad", "not a date")],
      NOW,
    );
    expect(result).toMatchObject({ id: "offset", effective_at: "2026-09-15T14:00:00.000Z" });
  });

  it("rejects an invalid now", () => {
    expect(() => selectNextOccurrence([], new Date("nope"))).toThrow(/invalid `now`/);
  });
});
