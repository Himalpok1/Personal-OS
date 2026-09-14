import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toWallClockComponents } from "../timezone.js";
import { deriveOccurrenceReminder, reminderDayOffset } from "./occurrence-reminder.js";

const CHICAGO = "America/Chicago";

// Due Tuesday 2026-03-10 09:00 Chicago (CDT), reminder the evening before at
// 20:00 -- the canonical "remind me the night before" series.
const PARENT = {
  dueAt: new Date("2026-03-10T14:00:00.000Z"),
  remindAt: new Date("2026-03-10T01:00:00.000Z"), // 2026-03-09 20:00 CDT
  recurrenceTimezone: CHICAGO,
};

function wall(instant: Date, tz: string) {
  const c = toWallClockComponents(instant, tz);
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")} ${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

describe("client-safety of the occurrence-reminder module", () => {
  it("imports only ../timezone.js", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./occurrence-reminder.ts", import.meta.url)),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers).toEqual(["../timezone.js"]);
    expect(source).not.toMatch(/createRequire|node:|require\(/);
  });
});

describe("reminderDayOffset", () => {
  it("is 1 for the evening before, 0 for the same day, -1 for the day after (signed, never clamped)", () => {
    expect(reminderDayOffset(PARENT)).toBe(1);
    expect(
      reminderDayOffset({ ...PARENT, remindAt: new Date("2026-03-10T13:30:00.000Z") }), // 08:30 same day
    ).toBe(0);
    // 9.4 review: due date and reminder are independent pickers, so a
    // reminder after the due date is a real choice, not an impossibility.
    expect(
      reminderDayOffset({ ...PARENT, remindAt: new Date("2026-03-11T13:00:00.000Z") }), // day AFTER
    ).toBe(-1);
    expect(
      reminderDayOffset({ ...PARENT, remindAt: new Date("2026-03-13T13:00:00.000Z") }), // 3 days after
    ).toBe(-3);
  });

  it("a same-day reminder later than the due time is still offset 0", () => {
    // Due 09:00, remind 17:00 the same day: a negative TIME delta is not a
    // negative DAY delta.
    expect(
      reminderDayOffset({ ...PARENT, remindAt: new Date("2026-03-10T22:00:00.000Z") }), // 17:00 CDT
    ).toBe(0);
  });

  it("is 0 when the parent has no due date", () => {
    expect(reminderDayOffset({ ...PARENT, dueAt: null })).toBe(0);
  });

  it("counts LOCAL calendar days, not UTC ones", () => {
    // 00:30 CDT on the 10th and 23:00 CDT on the 9th are both the 10th in
    // UTC (05:30Z and 04:00Z) -- but they are one local day apart.
    expect(
      reminderDayOffset({
        dueAt: new Date("2026-03-10T05:30:00.000Z"),
        remindAt: new Date("2026-03-10T04:00:00.000Z"),
        recurrenceTimezone: CHICAGO,
      }),
    ).toBe(1);
  });

  it("is exact across a DST transition (36 elapsed hours can still be 2 calendar days)", () => {
    // Due Mon 2026-03-09 09:00 CDT; remind Sat 2026-03-07 20:00 CST. The
    // spring-forward sits between them, so the instants are 36h apart --
    // naive-date arithmetic says 2 days, which is what the owner meant.
    expect(
      reminderDayOffset({
        dueAt: new Date("2026-03-09T14:00:00.000Z"),
        remindAt: new Date("2026-03-08T02:00:00.000Z"),
        recurrenceTimezone: CHICAGO,
      }),
    ).toBe(2);
  });
});

describe("deriveOccurrenceReminder (America/Chicago)", () => {
  it("the following week: 2026-03-17 09:00 → 2026-03-16 20:00 CDT", () => {
    const reminder = deriveOccurrenceReminder(PARENT, {
      occursAt: new Date("2026-03-17T14:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(reminder.toISOString()).toBe("2026-03-17T01:00:00.000Z");
    expect(wall(reminder, CHICAGO)).toBe("2026-03-16 20:00");
  });

  it("spring-forward: occurrence on 2026-03-08 09:00 keeps 20:00 wall clock on 03-07 (CST)", () => {
    // 09:00 on the transition day is already CDT (14:00Z); the prior evening
    // is still CST, so the reminder is UTC-6: 02:00Z, NOT 01:00Z.
    const reminder = deriveOccurrenceReminder(PARENT, {
      occursAt: new Date("2026-03-08T14:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-03-07 20:00");
    expect(reminder.toISOString()).toBe("2026-03-08T02:00:00.000Z");
    // 12 elapsed hours before the occurrence, not the usual 13 -- the wall
    // clock is the invariant, the elapsed duration is what flexes.
    expect(new Date("2026-03-08T14:00:00.000Z").getTime() - reminder.getTime()).toBe(
      12 * 60 * 60 * 1000,
    );
  });

  it("fall-back: occurrence on 2026-11-01 09:00 keeps 20:00 wall clock on 10-31 (CDT)", () => {
    // 09:00 on the fall-back day is CST (15:00Z); the prior evening is CDT
    // (UTC-5), so the reminder is 01:00Z -- 14 hours before, not 13.
    const reminder = deriveOccurrenceReminder(PARENT, {
      occursAt: new Date("2026-11-01T15:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-10-31 20:00");
    expect(reminder.toISOString()).toBe("2026-11-01T01:00:00.000Z");
  });

  it("the day after fall-back: 2026-11-02 09:00 → 2026-11-01 20:00 CST", () => {
    const reminder = deriveOccurrenceReminder(PARENT, {
      occursAt: new Date("2026-11-02T15:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-11-01 20:00");
    expect(reminder.toISOString()).toBe("2026-11-02T02:00:00.000Z");
  });

  it("snoozedUntil wins outright", () => {
    const snoozedUntil = new Date("2026-03-17T18:45:00.000Z");
    expect(
      deriveOccurrenceReminder(PARENT, {
        occursAt: new Date("2026-03-17T14:00:00.000Z"),
        snoozedUntil,
      }),
    ).toBe(snoozedUntil);
  });

  it("dueAt null → same date as the occurrence at the remind wall time", () => {
    const reminder = deriveOccurrenceReminder(
      { ...PARENT, dueAt: null },
      { occursAt: new Date("2026-03-17T14:00:00.000Z"), snoozedUntil: null },
    );
    expect(wall(reminder, CHICAGO)).toBe("2026-03-17 20:00");
    expect(reminder.toISOString()).toBe("2026-03-18T01:00:00.000Z");
  });

  it("a reminder the day AFTER the due date reminds the day after each occurrence", () => {
    // remind 2026-03-11 08:00 CDT for a task due 03-10 09:00: offset -1, so
    // the 03-17 occurrence reminds on 03-18 08:00 (9.4 review; this used to
    // clamp to same-day and remind on 03-17).
    const reminder = deriveOccurrenceReminder(
      { ...PARENT, remindAt: new Date("2026-03-11T13:00:00.000Z") },
      { occursAt: new Date("2026-03-17T14:00:00.000Z"), snoozedUntil: null },
    );
    expect(wall(reminder, CHICAGO)).toBe("2026-03-18 08:00");
    expect(reminder.toISOString()).toBe("2026-03-18T13:00:00.000Z");
  });

  it("a negative offset crosses the fall-back with its wall clock intact", () => {
    // Due Fri 2026-10-30 09:00 CDT, remind Sat 10-31 10:00 CDT (offset -1).
    // The occurrence on Sat 10-31 09:00 CDT reminds Sun 11-01 10:00 -- which
    // is CST after the 02:00 fall-back, so 16:00Z, not 15:00Z.
    const parent = {
      dueAt: new Date("2026-10-30T14:00:00.000Z"),
      remindAt: new Date("2026-10-31T15:00:00.000Z"),
      recurrenceTimezone: CHICAGO,
    };
    expect(reminderDayOffset(parent)).toBe(-1);
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-10-31T14:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-11-01 10:00");
    expect(reminder.toISOString()).toBe("2026-11-01T16:00:00.000Z");
  });

  it("a negative offset crosses the spring-forward with its wall clock intact", () => {
    // Due Fri 2026-03-06 09:00 CST, remind Sat 03-07 10:00 CST (offset -1).
    // The occurrence on Sat 03-07 09:00 CST reminds Sun 03-08 10:00 CDT = 15:00Z.
    const parent = {
      dueAt: new Date("2026-03-06T15:00:00.000Z"),
      remindAt: new Date("2026-03-07T16:00:00.000Z"),
      recurrenceTimezone: CHICAGO,
    };
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-03-07T15:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-03-08 10:00");
    expect(reminder.toISOString()).toBe("2026-03-08T15:00:00.000Z");
  });

  it("same-day reminder keeps its own time-of-day, not the occurrence's", () => {
    const reminder = deriveOccurrenceReminder(
      { ...PARENT, remindAt: new Date("2026-03-10T13:30:00.000Z") }, // 08:30 same day
      { occursAt: new Date("2026-03-17T14:00:00.000Z"), snoozedUntil: null },
    );
    expect(wall(reminder, CHICAGO)).toBe("2026-03-17 08:30");
  });

  it("a week-before reminder crosses the fall-back with its wall clock intact", () => {
    // Due 2026-11-05 09:00 CST, remind 7 days earlier at 09:00 (CDT) → offset 7.
    const parent = {
      dueAt: new Date("2026-11-05T15:00:00.000Z"),
      remindAt: new Date("2026-10-29T14:00:00.000Z"),
      recurrenceTimezone: CHICAGO,
    };
    expect(reminderDayOffset(parent)).toBe(7);
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-11-12T15:00:00.000Z"), // 09:00 CST
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-11-05 09:00");
    expect(reminder.toISOString()).toBe("2026-11-05T15:00:00.000Z");
  });

  it("an occurrence whose own time-of-day drifted still reminds at the parent's wall time", () => {
    // A lazy successor generated at 21:47 (pre-9.4 behaviour) still gets the
    // 20:00-the-day-before reminder, because the reminder reads the parent.
    const reminder = deriveOccurrenceReminder(PARENT, {
      occursAt: new Date("2026-03-18T02:47:00.000Z"), // 2026-03-17 21:47 CDT
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-03-16 20:00");
  });

  it("the local midnight edge: occurrence at 00:30 local reminds the previous local evening", () => {
    const parent = {
      dueAt: new Date("2026-03-10T05:30:00.000Z"), // 03-10 00:30 CDT
      remindAt: new Date("2026-03-10T04:00:00.000Z"), // 03-09 23:00 CDT
      recurrenceTimezone: CHICAGO,
    };
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-03-17T05:30:00.000Z"), // 03-17 00:30 CDT
      snoozedUntil: null,
    });
    expect(wall(reminder, CHICAGO)).toBe("2026-03-16 23:00");
    expect(reminder.toISOString()).toBe("2026-03-17T04:00:00.000Z");
  });
});

describe("deriveOccurrenceReminder (Pacific/Auckland — southern-hemisphere DST)", () => {
  const AUCKLAND = "Pacific/Auckland";
  // NZDT (UTC+13) ends 2026-04-05 03:00 → NZST (UTC+12).
  // Due Fri 2026-04-10 09:00 NZST; remind the evening before at 20:00 NZST.
  const parent = {
    dueAt: new Date("2026-04-09T21:00:00.000Z"),
    remindAt: new Date("2026-04-09T08:00:00.000Z"),
    recurrenceTimezone: AUCKLAND,
  };

  it("offset is one local day", () => {
    expect(reminderDayOffset(parent)).toBe(1);
  });

  it("an occurrence before the transition (NZDT) reminds at 20:00 NZDT the day before", () => {
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-04-02T20:00:00.000Z"), // 04-03 09:00 NZDT
      snoozedUntil: null,
    });
    expect(wall(reminder, AUCKLAND)).toBe("2026-04-02 20:00");
    expect(reminder.toISOString()).toBe("2026-04-02T07:00:00.000Z");
  });

  it("an occurrence the day after the transition reminds at 20:00 NZST on the transition day", () => {
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-04-05T21:00:00.000Z"), // 04-06 09:00 NZST
      snoozedUntil: null,
    });
    expect(wall(reminder, AUCKLAND)).toBe("2026-04-05 20:00");
    expect(reminder.toISOString()).toBe("2026-04-05T08:00:00.000Z");
  });

  it("the UTC date of the occurrence differs from its local date and that never leaks", () => {
    // 04-13 09:00 NZST is 04-12 21:00Z; the reminder must be 04-12 20:00
    // LOCAL (04-12 08:00Z), not "20:00 on the UTC date minus one".
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-04-12T21:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, AUCKLAND)).toBe("2026-04-12 20:00");
    expect(reminder.toISOString()).toBe("2026-04-12T08:00:00.000Z");
  });
});

describe("deriveOccurrenceReminder (Europe/London — two-day offset across the October fall-back)", () => {
  const LONDON = "Europe/London";
  // BST (UTC+1) ends 2026-10-25 02:00 → GMT.
  // Due Tue 2026-10-20 09:00 BST; remind Sun 2026-10-18 18:30 BST (two days before).
  const parent = {
    dueAt: new Date("2026-10-20T08:00:00.000Z"),
    remindAt: new Date("2026-10-18T17:30:00.000Z"),
    recurrenceTimezone: LONDON,
  };

  it("offset is two local days", () => {
    expect(reminderDayOffset(parent)).toBe(2);
  });

  it("the occurrence after the transition reminds at 18:30 GMT two days before", () => {
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-10-27T09:00:00.000Z"), // 10-27 09:00 GMT
      snoozedUntil: null,
    });
    expect(wall(reminder, LONDON)).toBe("2026-10-25 18:30");
    expect(reminder.toISOString()).toBe("2026-10-25T18:30:00.000Z");
  });

  it("an occurrence straddling the transition reminds in BST while the occurrence is in GMT", () => {
    // 10-26 09:00 GMT; two days earlier is 10-24 18:30 BST (17:30Z).
    const reminder = deriveOccurrenceReminder(parent, {
      occursAt: new Date("2026-10-26T09:00:00.000Z"),
      snoozedUntil: null,
    });
    expect(wall(reminder, LONDON)).toBe("2026-10-24 18:30");
    expect(reminder.toISOString()).toBe("2026-10-24T17:30:00.000Z");
  });
});
