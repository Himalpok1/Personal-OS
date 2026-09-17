import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "../academic/buckets.js";
import {
  BRIEFING_FOCUS_LIMIT,
  BRIEFING_FREE_BLOCK_LIMIT,
  BRIEFING_SECTION_KINDS,
  BRIEFING_SECTION_TITLE,
  BRIEFING_SLEEP_ABOVE_RATIO,
  BRIEFING_SLEEP_BELOW_RATIO,
  composeBriefing,
  formatDurationShort,
  formatWallTime,
  type BriefingAcademicInput,
  type BriefingEventInput,
  type BriefingHealthInput,
  type BriefingInput,
} from "./briefing.js";
import {
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  mergeLinkedCandidates,
  rankFocusNowCandidates,
  type FocusNowCandidate,
} from "./score.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);
const HOUR = 60 * 60 * 1000;
// 2026-09-16 14:00 CDT, the shared fixture; working window ends 22:00 CDT = 03:00Z.
const NOW = iso("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const { horizonEndUtc: HORIZON } = academicTodayWindows(TZ, NOW);

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    effectiveNow: NOW,
    tz: TZ,
    today: { overdueTotal: 0, dueTodayTotal: 0, eventsToday: [], inboxAttentionTotal: 0 },
    academic: null,
    health: null,
    focus: [],
    ...overrides,
  };
}

function academic(overrides: Partial<BriefingAcademicInput> = {}): BriefingAcademicInput {
  return {
    configured: true,
    overdueTotal: 0,
    dueTodayTotal: 0,
    dueThisWeekTotal: 0,
    workloadStatus: null,
    unreadAnnouncements: 0,
    ...overrides,
  };
}

function health(overrides: Partial<BriefingHealthInput> = {}): BriefingHealthInput {
  return {
    latestSleepSeconds: 6 * 3600 + 10 * 60,
    latestSleepWakeLocalDate: "2026-09-16",
    sleep7dAverageSeconds: 7 * 3600 + 5 * 60,
    ...overrides,
  };
}

function timed(title: string, start: Date, end: Date): BriefingEventInput {
  return { title, startsAt: start, endsAt: end, allDay: false };
}

function c(overrides: Partial<FocusNowCandidate>): FocusNowCandidate {
  const score = overrides.score ?? 100;
  return {
    id: "z",
    kind: "task",
    title: "Z",
    dueAt: null,
    baseScore: score,
    contextPoints: 0,
    score,
    reasons: [],
    linkedAssignmentId: null,
    ...overrides,
  };
}

const section = (briefing: ReturnType<typeof composeBriefing>, kind: string) =>
  briefing.sections.find((s) => s.kind === kind);

describe("formatting helpers", () => {
  it("formatDurationShort: hours with zero-padded minutes, bare minutes under an hour, zero for junk", () => {
    expect(formatDurationShort(6 * 3600 + 10 * 60)).toBe("6h 10m");
    expect(formatDurationShort(7 * 3600 + 5 * 60)).toBe("7h 05m");
    expect(formatDurationShort(8 * 3600)).toBe("8h 00m");
    expect(formatDurationShort(45 * 60 + 59)).toBe("45m");
    expect(formatDurationShort(0)).toBe("0m");
    expect(formatDurationShort(-30)).toBe("0m");
    expect(formatDurationShort(Number.NaN)).toBe("0m");
  });

  it("formatWallTime: 24-hour HH:mm in the given zone", () => {
    expect(formatWallTime(NOW, TZ)).toBe("14:00");
    expect(formatWallTime(NOW, "UTC")).toBe("19:00");
    expect(formatWallTime(iso("2026-09-17T05:05:00Z"), TZ)).toBe("00:05");
  });
});

describe("composeBriefing -- structure", () => {
  it("exports the frozen section order, titles and limits", () => {
    expect(BRIEFING_SECTION_KINDS).toEqual(["academic", "schedule", "health", "focus"]);
    expect(BRIEFING_SECTION_TITLE).toEqual({
      academic: "Academics",
      schedule: "Schedule",
      health: "Health",
      focus: "Focus now",
    });
    expect(BRIEFING_FOCUS_LIMIT).toBe(3);
    expect(BRIEFING_FREE_BLOCK_LIMIT).toBe(2);
    expect(BRIEFING_SLEEP_BELOW_RATIO).toBe(0.9);
    expect(BRIEFING_SLEEP_ABOVE_RATIO).toBe(1.1);
  });

  it("emits sections in the frozen order and only those with something to say", () => {
    const briefing = composeBriefing(
      input({
        academic: academic({ overdueTotal: 1 }),
        health: health(),
        focus: [c({ id: "t", title: "T", reasons: ["overdue"], score: 400 })],
        today: {
          overdueTotal: 1,
          dueTodayTotal: 0,
          eventsToday: [timed("Standup", plus(HOUR), plus(2 * HOUR))],
          inboxAttentionTotal: 0,
        },
      }),
    );
    expect(briefing.sections.map((s) => s.kind)).toEqual([
      "academic",
      "schedule",
      "health",
      "focus",
    ]);
  });

  it("is an empty briefing, never invented, after hours with nothing anywhere", () => {
    const late = iso("2026-09-17T04:00:00Z"); // 23:00 CDT, past the working window
    expect(composeBriefing(input({ effectiveNow: late }))).toEqual({
      sections: [],
      headline: "Nothing due today.",
    });
  });
});

describe("composeBriefing -- academic", () => {
  it("is omitted when the source is absent, null, or not configured", () => {
    expect(section(composeBriefing(input({ academic: undefined })), "academic")).toBeUndefined();
    expect(section(composeBriefing(input({ academic: null })), "academic")).toBeUndefined();
    expect(
      section(
        composeBriefing(
          input({
            academic: academic({ configured: false, overdueTotal: 5, workloadStatus: "behind" }),
          }),
        ),
        "academic",
      ),
    ).toBeUndefined();
  });

  it("is omitted when configured but every count is zero and there is no workload status", () => {
    expect(section(composeBriefing(input({ academic: academic() })), "academic")).toBeUndefined();
  });

  it("names each non-zero count, the workload phrase and unread announcements, toned", () => {
    const result = section(
      composeBriefing(
        input({
          academic: academic({
            overdueTotal: 2,
            dueTodayTotal: 1,
            dueThisWeekTotal: 8,
            workloadStatus: "behind",
            unreadAnnouncements: 1,
          }),
        }),
      ),
      "academic",
    );
    expect(result).toEqual({
      kind: "academic",
      title: "Academics",
      lines: [
        { text: "2 overdue", source: "canvas_assignment", tone: "danger" },
        { text: "1 due today", source: "canvas_assignment", tone: "warning" },
        { text: "8 due this week", source: "canvas_assignment", tone: "neutral" },
        { text: "You're behind", source: "canvas_assignment", tone: "danger" },
        { text: "1 unread announcement", source: "course", tone: "neutral" },
      ],
    });
  });

  it("tones the workload phrase by status and pluralizes announcements", () => {
    const atRisk = section(
      composeBriefing(
        input({ academic: academic({ workloadStatus: "at_risk", unreadAnnouncements: 3 }) }),
      ),
      "academic",
    );
    expect(atRisk?.lines).toEqual([
      { text: "At risk", source: "canvas_assignment", tone: "warning" },
      { text: "3 unread announcements", source: "course", tone: "neutral" },
    ]);
    const onTrack = section(
      composeBriefing(input({ academic: academic({ workloadStatus: "on_track" }) })),
      "academic",
    );
    expect(onTrack?.lines).toEqual([
      { text: "On track", source: "canvas_assignment", tone: "success" },
    ]);
  });
});

describe("composeBriefing -- schedule", () => {
  it("names the count, the next timed event at its wall clock, and up to two free blocks", () => {
    const result = section(
      composeBriefing(
        input({
          today: {
            overdueTotal: 0,
            dueTodayTotal: 0,
            eventsToday: [
              { title: "Conference", startsAt: null, endsAt: null, allDay: true },
              timed("Dentist", plus(2 * HOUR), plus(3 * HOUR)), // 16:00–17:00
              timed("Dinner", plus(5 * HOUR), plus(6 * HOUR)), // 19:00–20:00
              timed("Earlier", plus(-3 * HOUR), plus(-2 * HOUR)), // over
            ],
            inboxAttentionTotal: 0,
          },
        }),
      ),
      "schedule",
    );
    expect(result).toEqual({
      kind: "schedule",
      title: "Schedule",
      lines: [
        { text: "4 events today", source: "calendar", tone: "neutral" },
        { text: "Next: Dentist at 16:00", source: "calendar", tone: "neutral" },
        { text: "Free 14:00–16:00 (2h 00m)", source: "calendar", tone: "neutral" },
        { text: "Free 17:00–19:00 (2h 00m)", source: "calendar", tone: "neutral" },
      ],
    });
    // The third block (20:00–22:00) exists but is beyond the two-line cap.
  });

  it("uses '1 event' for one, and picks the earliest upcoming event with a title tie-break", () => {
    const result = section(
      composeBriefing(
        input({
          today: {
            overdueTotal: 0,
            dueTodayTotal: 0,
            eventsToday: [
              timed("Zeta", plus(HOUR), plus(2 * HOUR)),
              timed("Alpha", plus(HOUR), plus(2 * HOUR)),
            ],
            inboxAttentionTotal: 0,
          },
        }),
      ),
      "schedule",
    );
    expect(result?.lines[0]?.text).toBe("2 events today");
    expect(result?.lines[1]?.text).toBe("Next: Alpha at 15:00");
  });

  it("with no events still reports the remaining free time, and is omitted after hours", () => {
    expect(section(composeBriefing(input()), "schedule")?.lines).toEqual([
      { text: "Free 14:00–22:00 (8h 00m)", source: "calendar", tone: "neutral" },
    ]);
    const late = iso("2026-09-17T04:00:00Z"); // 23:00 CDT
    expect(section(composeBriefing(input({ effectiveNow: late })), "schedule")).toBeUndefined();
  });

  it("an event in progress at effectiveNow is counted but not 'Next'", () => {
    const result = section(
      composeBriefing(
        input({
          today: {
            overdueTotal: 0,
            dueTodayTotal: 0,
            eventsToday: [timed("Lecture", plus(-HOUR), plus(HOUR))],
            inboxAttentionTotal: 0,
          },
        }),
      ),
      "schedule",
    );
    expect(result?.lines.map((l) => l.text)).toEqual([
      "1 event today",
      "Free 15:00–22:00 (7h 00m)",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 10.7 (ADR-077 §5): the working-hours memory and the memory source
// ---------------------------------------------------------------------------

describe("composeBriefing -- schedule with a working-hours memory", () => {
  const memory = { workingHours: { dayStartHour: 9, dayEndHour: 18 } };

  it("bounds the free blocks by the memory's hours and names them in one memory-sourced line, before the blocks", () => {
    const result = section(
      composeBriefing(
        input({
          memory,
          today: {
            overdueTotal: 0,
            dueTodayTotal: 0,
            eventsToday: [timed("Dentist", plus(2 * HOUR), plus(3 * HOUR))], // 16:00–17:00
            inboxAttentionTotal: 0,
          },
        }),
      ),
      "schedule",
    );
    expect(result).toEqual({
      kind: "schedule",
      title: "Schedule",
      lines: [
        { text: "1 event today", source: "calendar", tone: "neutral" },
        { text: "Next: Dentist at 16:00", source: "calendar", tone: "neutral" },
        {
          text: "Working hours 09:00–18:00 — from your preferences",
          source: "memory",
          tone: "neutral",
        },
        { text: "Free 14:00–16:00 (2h 00m)", source: "calendar", tone: "neutral" },
        { text: "Free 17:00–18:00 (1h 00m)", source: "calendar", tone: "neutral" },
      ],
    });
    // The memory line carries no ref: there is no row to navigate to.
    expect(result?.lines[2]).not.toHaveProperty("ref");
  });

  it("with no events, the memory line precedes the single remaining block", () => {
    expect(section(composeBriefing(input({ memory })), "schedule")?.lines).toEqual([
      {
        text: "Working hours 09:00–18:00 — from your preferences",
        source: "memory",
        tone: "neutral",
      },
      { text: "Free 14:00–18:00 (4h 00m)", source: "calendar", tone: "neutral" },
    ]);
  });

  it("is omitted entirely after the owner's hours with no events -- the line never stands alone", () => {
    const afterHours = iso("2026-09-16T23:30:00Z"); // 18:30 CDT: inside the 22:00 default, past the memory's 18:00
    expect(section(composeBriefing(input({ effectiveNow: afterHours })), "schedule")).toBeDefined();
    expect(
      section(composeBriefing(input({ effectiveNow: afterHours, memory })), "schedule"),
    ).toBeUndefined();
  });

  it("treats absent, null, and invalid memory hours as the defaults, with no memory line", () => {
    const plain = section(composeBriefing(input()), "schedule");
    expect(section(composeBriefing(input({ memory: null })), "schedule")).toEqual(plain);
    expect(section(composeBriefing(input({ memory: {} })), "schedule")).toEqual(plain);
    expect(section(composeBriefing(input({ memory: { workingHours: null } })), "schedule")).toEqual(
      plain,
    );
    for (const workingHours of [
      { dayStartHour: 18, dayEndHour: 9 },
      { dayStartHour: 9, dayEndHour: 9 },
      { dayStartHour: 9.5, dayEndHour: 18 },
      { dayStartHour: -1, dayEndHour: 18 },
      { dayStartHour: 9, dayEndHour: 25 },
    ]) {
      expect(
        section(composeBriefing(input({ memory: { workingHours } })), "schedule"),
        JSON.stringify(workingHours),
      ).toEqual(plain);
    }
    expect(plain?.lines.some((l) => l.source === "memory")).toBe(false);
  });

  it("DST fall-back day 2026-11-01 under memory bounds: the free window is 09:00–18:00 CST, 9h on the clock", () => {
    const early = iso("2026-11-01T05:30:00Z"); // 00:30 CDT
    const result = section(composeBriefing(input({ effectiveNow: early, memory })), "schedule");
    expect(result?.lines).toEqual([
      {
        text: "Working hours 09:00–18:00 — from your preferences",
        source: "memory",
        tone: "neutral",
      },
      { text: "Free 09:00–18:00 (9h 00m)", source: "calendar", tone: "neutral" },
    ]);
  });

  it("leaves the headline, and every other section, untouched by the memory input", () => {
    const withMemory = composeBriefing(
      input({ memory, academic: academic({ overdueTotal: 1 }), health: health() }),
    );
    const without = composeBriefing(
      input({ academic: academic({ overdueTotal: 1 }), health: health() }),
    );
    expect(withMemory.headline).toBe(without.headline);
    expect(section(withMemory, "academic")).toEqual(section(without, "academic"));
    expect(section(withMemory, "health")).toEqual(section(without, "health"));
    expect(BRIEFING_SECTION_KINDS).toEqual(["academic", "schedule", "health", "focus"]); // no new section kind
  });
});

describe("composeBriefing -- focus lines inherit a memory-driven primary source", () => {
  it("a row whose only reason is a memory reason reads with source memory and the static why", () => {
    const only = c({
      id: "m",
      title: "Read chapter 4",
      reasons: ["supports_goal"],
      baseScore: 100,
      contextPoints: 15,
      score: 115,
    });
    expect(section(composeBriefing(input({ focus: [only] })), "focus")?.lines).toEqual([
      {
        text: "Read chapter 4 — A saved goal is linked to this item's project",
        source: "memory",
        tone: "neutral",
        ref: { kind: "task", id: "m" },
      },
    ]);
  });

  it("a memory reason never displaces the urgency as the primary: the line keeps the task source", () => {
    const remembered = focusNowCandidateFromTask(
      {
        id: "t",
        title: "Call the insurance guy",
        dueAt: plus(-1),
        priority: null,
        memory: { matchesPreference: true, supportsGoal: true },
      },
      NOW,
      HORIZON,
    );
    expect(section(composeBriefing(input({ focus: [remembered] })), "focus")?.lines).toEqual([
      {
        text: "Call the insurance guy — Past its due time",
        source: "task",
        tone: "danger",
        ref: { kind: "task", id: "t" },
      },
    ]);
  });
});

describe("composeBriefing -- health", () => {
  it("compares last night's sleep to the 7-day average, with the documented thresholds", () => {
    const below = section(composeBriefing(input({ health: health() })), "health");
    expect(below).toEqual({
      kind: "health",
      title: "Health",
      lines: [
        {
          text: "Slept 6h 10m — below your 7-day average (7h 05m)",
          source: "health",
          tone: "warning",
        },
      ],
    });

    const avg = 7 * 3600;
    const at90 = section(
      composeBriefing(
        input({ health: health({ latestSleepSeconds: avg * 0.9, sleep7dAverageSeconds: avg }) }),
      ),
      "health",
    );
    expect(at90?.lines[0]).toMatchObject({ tone: "neutral" });
    expect(at90?.lines[0]?.text).toContain("in line with");

    const at110 = section(
      composeBriefing(
        input({ health: health({ latestSleepSeconds: avg * 1.1, sleep7dAverageSeconds: avg }) }),
      ),
      "health",
    );
    expect(at110?.lines[0]).toMatchObject({ tone: "neutral" });

    const above = section(
      composeBriefing(
        input({
          health: health({ latestSleepSeconds: avg * 1.1 + 60, sleep7dAverageSeconds: avg }),
        }),
      ),
      "health",
    );
    expect(above?.lines[0]).toMatchObject({ tone: "success" });
    expect(above?.lines[0]?.text).toBe("Slept 7h 43m — above your 7-day average (7h 00m)");
  });

  it("accepts a wake date of today or yesterday in tz, and nothing older", () => {
    expect(
      section(
        composeBriefing(input({ health: health({ latestSleepWakeLocalDate: "2026-09-15" }) })),
        "health",
      ),
    ).toBeDefined();
    expect(
      section(
        composeBriefing(input({ health: health({ latestSleepWakeLocalDate: "2026-09-14" }) })),
        "health",
      ),
    ).toBeUndefined();
    expect(
      section(
        composeBriefing(input({ health: health({ latestSleepWakeLocalDate: "2026-09-17" }) })),
        "health",
      ),
    ).toBeUndefined();
  });

  it("judges 'today' in the request tz, not UTC", () => {
    // 2026-09-16 23:30 CDT is already 2026-09-17 in UTC; the wake date 09-15 is still "yesterday" in Chicago.
    const lateEvening = iso("2026-09-17T04:30:00Z");
    expect(
      section(
        composeBriefing(
          input({
            effectiveNow: lateEvening,
            health: health({ latestSleepWakeLocalDate: "2026-09-15" }),
          }),
        ),
        "health",
      ),
    ).toBeDefined();
  });

  it("is omitted when any input is missing, the average is non-positive, or the source is absent", () => {
    expect(section(composeBriefing(input({ health: undefined })), "health")).toBeUndefined();
    expect(
      section(composeBriefing(input({ health: health({ latestSleepSeconds: null }) })), "health"),
    ).toBeUndefined();
    expect(
      section(
        composeBriefing(input({ health: health({ latestSleepWakeLocalDate: null }) })),
        "health",
      ),
    ).toBeUndefined();
    expect(
      section(
        composeBriefing(input({ health: health({ sleep7dAverageSeconds: null }) })),
        "health",
      ),
    ).toBeUndefined();
    expect(
      section(composeBriefing(input({ health: health({ sleep7dAverageSeconds: 0 }) })), "health"),
    ).toBeUndefined();
  });
});

describe("composeBriefing -- focus", () => {
  it("names the top three already-ranked candidates with their primary why, ref, tone and source", () => {
    const ranked = rankFocusNowCandidates(
      mergeLinkedCandidates([
        focusNowCandidateFromTask(
          { id: "t1", title: "Call the insurance guy", dueAt: plus(-1), priority: 1 },
          NOW,
          HORIZON,
        ),
        focusNowCandidateFromAcademic({
          id: "a1",
          title: "Lab report",
          dueAt: plus(HOUR),
          score: 325,
          reasons: ["due_within_24h", "high_points"],
        }),
        focusNowCandidateFromTask(
          { id: "t2", title: "Water the plants", dueAt: null, priority: null, remindAt: NOW },
          NOW,
          HORIZON,
        ),
        focusNowCandidateFromTask(
          { id: "t3", title: "Later today", dueAt: plus(3 * HOUR), priority: null },
          NOW,
          HORIZON,
        ),
      ]),
    );
    const result = section(composeBriefing(input({ focus: ranked })), "focus");
    expect(result).toEqual({
      kind: "focus",
      title: "Focus now",
      lines: [
        {
          text: "Call the insurance guy — Past its due time",
          source: "task",
          tone: "danger",
          ref: { kind: "task", id: "t1" },
        },
        {
          text: "Lab report — Due within 24 hours",
          source: "canvas_assignment",
          tone: "warning",
          ref: { kind: "academic_assignment", id: "a1" },
        },
        {
          text: "Later today — Due within 24 hours",
          source: "task",
          tone: "warning",
          ref: { kind: "task", id: "t3" },
        },
      ],
    });
  });

  it("renders a reason-less candidate as its bare title with the kind's own source", () => {
    const result = section(
      composeBriefing(
        input({
          focus: [
            c({ id: "x", title: "Bare task" }),
            c({ id: "y", kind: "academic_assignment", title: "Bare assignment" }),
          ],
        }),
      ),
      "focus",
    );
    expect(result?.lines).toEqual([
      { text: "Bare task", source: "task", tone: "neutral", ref: { kind: "task", id: "x" } },
      {
        text: "Bare assignment",
        source: "canvas_assignment",
        tone: "neutral",
        ref: { kind: "academic_assignment", id: "y" },
      },
    ]);
  });

  it("is omitted with no candidates and never re-ranks the caller's list", () => {
    expect(section(composeBriefing(input({ focus: [] })), "focus")).toBeUndefined();
    const lowFirst = [c({ id: "low", score: 100 }), c({ id: "high", score: 400 })];
    expect(
      section(composeBriefing(input({ focus: lowFirst })), "focus")?.lines.map((l) => l.ref?.id),
    ).toEqual(["low", "high"]);
  });
});

describe("composeBriefing -- headline", () => {
  it("sums personal and academic counts into one sentence", () => {
    const briefing = composeBriefing(
      input({
        today: {
          overdueTotal: 1,
          dueTodayTotal: 0,
          eventsToday: [
            timed("A", plus(HOUR), plus(2 * HOUR)),
            timed("B", plus(HOUR), plus(2 * HOUR)),
            timed("C", plus(HOUR), plus(2 * HOUR)),
          ],
          inboxAttentionTotal: 4,
        },
        academic: academic({ overdueTotal: 1, dueTodayTotal: 1 }),
      }),
    );
    expect(briefing.headline).toBe("2 overdue, 1 due today, 3 events.");
  });

  it("ignores academic counts when the source is not configured", () => {
    const briefing = composeBriefing(
      input({ academic: academic({ configured: false, overdueTotal: 9 }) }),
    );
    expect(briefing.headline).toBe("Nothing due today.");
  });

  it("says 'Nothing due today' and appends the event count when there is one", () => {
    expect(composeBriefing(input()).headline).toBe("Nothing due today.");
    expect(
      composeBriefing(
        input({
          today: {
            overdueTotal: 0,
            dueTodayTotal: 0,
            eventsToday: [timed("Only", plus(HOUR), plus(2 * HOUR))],
            inboxAttentionTotal: 0,
          },
        }),
      ).headline,
    ).toBe("Nothing due today, 1 event.");
    expect(
      composeBriefing(
        input({
          today: { overdueTotal: 0, dueTodayTotal: 2, eventsToday: [], inboxAttentionTotal: 0 },
        }),
      ).headline,
    ).toBe("2 due today.");
  });
});

describe("composeBriefing -- determinism", () => {
  it("is byte-identical for identical inputs", () => {
    const build = () =>
      composeBriefing(
        input({
          academic: academic({ overdueTotal: 1, workloadStatus: "behind" }),
          health: health(),
          focus: [c({ id: "t", title: "T", reasons: ["overdue"], score: 400 })],
          today: {
            overdueTotal: 1,
            dueTodayTotal: 1,
            eventsToday: [timed("Standup", plus(HOUR), plus(2 * HOUR))],
            inboxAttentionTotal: 0,
          },
        }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
