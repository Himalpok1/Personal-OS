import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "./buckets.js";
import {
  ACADEMIC_COURSE_ATTENTION_LEVELS,
  ACADEMIC_PRIORITY_POINTS,
  ACADEMIC_PRIORITY_REASONS,
  ACADEMIC_URGENCY_BASE_POINTS,
  ACADEMIC_URGENCY_LEVELS,
  ACADEMIC_WORKLOAD_STATUSES,
  HIGH_POINTS_THRESHOLD,
  URGENCY_HIGH_WINDOW_HOURS,
  compareAcademicPriorities,
  courseAttentionRank,
  deriveCourseAttention,
  deriveUrgency,
  deriveWorkloadStatus,
  hoursUntilDue,
  rankAcademicPriorities,
  roundToOneDecimal,
  scoreAcademicPriority,
  type AcademicPriorityCandidate,
  type AcademicPriorityInput,
} from "./urgency.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-09-16 14:00 CDT; today's window is [05:00Z 09-16, 05:00Z 09-17) and the
// 7-day horizon ends at 05:00Z 09-24 -- the same fixture the bucket tests use.
const NOW = iso("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const { horizonEndUtc: HORIZON } = academicTodayWindows(TZ, NOW);

describe("the closed vocabularies", () => {
  it("are frozen in the documented order", () => {
    expect(ACADEMIC_URGENCY_LEVELS).toEqual(["critical", "high", "medium", "low"]);
    expect(ACADEMIC_PRIORITY_REASONS).toEqual([
      "overdue",
      "due_within_24h",
      "due_this_week",
      "marked_missing",
      "marked_late",
      "high_points",
    ]);
    expect(ACADEMIC_WORKLOAD_STATUSES).toEqual(["on_track", "at_risk", "behind"]);
    expect(ACADEMIC_COURSE_ATTENTION_LEVELS).toEqual(["high", "medium", "low", "none"]);
  });

  it("pins the thresholds and the point tables", () => {
    expect(URGENCY_HIGH_WINDOW_HOURS).toBe(24);
    expect(HIGH_POINTS_THRESHOLD).toBe(50);
    expect(ACADEMIC_URGENCY_BASE_POINTS).toEqual({
      critical: 400,
      high: 300,
      medium: 200,
      low: 100,
    });
    expect(ACADEMIC_PRIORITY_POINTS).toEqual({
      overdue: 400,
      due_within_24h: 300,
      due_this_week: 200,
      marked_missing: 50,
      marked_late: 25,
      high_points: 25,
    });
  });
});

describe("deriveUrgency -- the ladder and its boundaries", () => {
  it("is null for an undated assignment (undated is never urgent)", () => {
    expect(deriveUrgency(null, NOW, HORIZON)).toBeNull();
  });

  it("is critical when overdue by even one millisecond", () => {
    expect(deriveUrgency(plus(-1), NOW, HORIZON)).toBe("critical");
    expect(deriveUrgency(plus(-30 * DAY), NOW, HORIZON)).toBe("critical");
  });

  it("is high at exactly effectiveNow (strict <, rule 2) and just under 24h out", () => {
    expect(deriveUrgency(NOW, NOW, HORIZON)).toBe("high");
    expect(deriveUrgency(plus(24 * HOUR - 1), NOW, HORIZON)).toBe("high");
  });

  it("is medium at exactly 24h out (strict <) and just under the horizon end", () => {
    expect(deriveUrgency(plus(24 * HOUR), NOW, HORIZON)).toBe("medium");
    expect(deriveUrgency(new Date(HORIZON.getTime() - 1), NOW, HORIZON)).toBe("medium");
  });

  it("is low at exactly the horizon end (exclusive, like the buckets) and beyond", () => {
    expect(deriveUrgency(HORIZON, NOW, HORIZON)).toBe("low");
    expect(deriveUrgency(plus(60 * DAY), NOW, HORIZON)).toBe("low");
  });

  it("uses the caller's local-day horizon, not 7 x 24h from now", () => {
    // Day + 7 at 14:00 local is 7 x 24h from NOW exactly -- still before the
    // local horizon end (start of local 09-24), so medium, not low.
    expect(deriveUrgency(plus(7 * DAY), NOW, HORIZON)).toBe("medium");
    // The last instant of local 09-23 is medium; local midnight 09-24 is low.
    expect(deriveUrgency(iso("2026-09-24T04:59:59.999Z"), NOW, HORIZON)).toBe("medium");
    expect(deriveUrgency(iso("2026-09-24T05:00:00Z"), NOW, HORIZON)).toBe("low");
  });

  it("agrees with the buckets across the spring-forward 23-hour day", () => {
    // 07:00 CDT on 2026-03-08, after the jump; horizon end is 05:00Z 03-16.
    const now = iso("2026-03-08T12:00:00Z");
    const { horizonEndUtc } = academicTodayWindows(TZ, now);
    expect(horizonEndUtc.toISOString()).toBe("2026-03-16T05:00:00.000Z");
    expect(deriveUrgency(iso("2026-03-16T04:59:59Z"), now, horizonEndUtc)).toBe("medium");
    expect(deriveUrgency(iso("2026-03-16T05:00:00Z"), now, horizonEndUtc)).toBe("low");
    // 24h after 12:00Z is 12:00Z next day -- an instant comparison, untouched by DST.
    expect(deriveUrgency(iso("2026-03-09T11:59:59Z"), now, horizonEndUtc)).toBe("high");
    expect(deriveUrgency(iso("2026-03-09T12:00:00Z"), now, horizonEndUtc)).toBe("medium");
  });

  it("agrees with the buckets across the fall-back 25-hour day", () => {
    // 06:00 CST on 2026-11-01, after the repeated hour; horizon end 06:00Z 11-09.
    const now = iso("2026-11-01T12:00:00Z");
    const { horizonEndUtc } = academicTodayWindows(TZ, now);
    expect(horizonEndUtc.toISOString()).toBe("2026-11-09T06:00:00.000Z");
    expect(deriveUrgency(iso("2026-11-09T05:59:59Z"), now, horizonEndUtc)).toBe("medium");
    expect(deriveUrgency(iso("2026-11-09T06:00:00Z"), now, horizonEndUtc)).toBe("low");
  });
});

describe("hoursUntilDue", () => {
  it("is signed, one decimal, null when undated, and never -0", () => {
    expect(hoursUntilDue(null, NOW)).toBeNull();
    expect(hoursUntilDue(plus(90 * 60 * 1000), NOW)).toBe(1.5);
    expect(hoursUntilDue(plus(-2 * HOUR - 6 * 60 * 1000), NOW)).toBe(-2.1);
    expect(hoursUntilDue(plus(-1), NOW)).toBe(0);
    expect(Object.is(hoursUntilDue(plus(-1), NOW), -0)).toBe(false);
    expect(hoursUntilDue(NOW, NOW)).toBe(0);
  });

  it("roundToOneDecimal rounds half away from zero on the positive side and normalizes -0", () => {
    expect(roundToOneDecimal(1.25)).toBe(1.3);
    expect(roundToOneDecimal(1.24)).toBe(1.2);
    expect(roundToOneDecimal(-0.04)).toBe(0);
    expect(Object.is(roundToOneDecimal(-0.04), -0)).toBe(false);
  });
});

describe("scoreAcademicPriority -- integer points over a closed vocabulary", () => {
  const base = (urgency: AcademicPriorityInput["urgency"]): AcademicPriorityInput => ({
    urgency,
    missing: false,
    late: false,
    pointsPossible: null,
    hoursUntilDue: null,
  });

  it("assigns the urgency base and names its reason for critical / high / medium", () => {
    expect(scoreAcademicPriority(base("critical"))).toEqual({ score: 400, reasons: ["overdue"] });
    expect(scoreAcademicPriority(base("high"))).toEqual({
      score: 300,
      reasons: ["due_within_24h"],
    });
    expect(scoreAcademicPriority(base("medium"))).toEqual({
      score: 200,
      reasons: ["due_this_week"],
    });
  });

  it("gives low its 100 base with NO reason", () => {
    expect(scoreAcademicPriority(base("low"))).toEqual({ score: 100, reasons: [] });
  });

  it("stacks the three additive reasons in vocabulary order", () => {
    expect(
      scoreAcademicPriority({
        ...base("critical"),
        missing: true,
        late: true,
        pointsPossible: 100,
      }),
    ).toEqual({
      score: 500,
      reasons: ["overdue", "marked_missing", "marked_late", "high_points"],
    });
  });

  it("high_points is inclusive at the threshold and never fires on null or below", () => {
    expect(scoreAcademicPriority({ ...base("low"), pointsPossible: 50 })).toEqual({
      score: 125,
      reasons: ["high_points"],
    });
    expect(scoreAcademicPriority({ ...base("low"), pointsPossible: 49.9 })).toEqual({
      score: 100,
      reasons: [],
    });
    expect(scoreAcademicPriority({ ...base("low"), pointsPossible: 0 }).reasons).toEqual([]);
    expect(scoreAcademicPriority({ ...base("low"), pointsPossible: null }).reasons).toEqual([]);
  });

  it("score is always the urgency base plus the additive reasons' points (auditable)", () => {
    const inputs: AcademicPriorityInput[] = [];
    for (const urgency of ACADEMIC_URGENCY_LEVELS) {
      for (const missing of [false, true]) {
        for (const late of [false, true]) {
          for (const pointsPossible of [null, 10, 50, 200]) {
            inputs.push({ urgency, missing, late, pointsPossible, hoursUntilDue: null });
          }
        }
      }
    }
    for (const input of inputs) {
      const { score, reasons } = scoreAcademicPriority(input);
      const additive = reasons
        .filter((r) => r === "marked_missing" || r === "marked_late" || r === "high_points")
        .reduce((sum, r) => sum + ACADEMIC_PRIORITY_POINTS[r], 0);
      expect(score).toBe(ACADEMIC_URGENCY_BASE_POINTS[input.urgency] + additive);
      expect(Number.isInteger(score)).toBe(true);
      // Every reason is a member of the closed vocabulary, at most once.
      expect(new Set(reasons).size).toBe(reasons.length);
      for (const r of reasons) expect(ACADEMIC_PRIORITY_REASONS).toContain(r);
    }
  });

  it("hoursUntilDue is accepted but contributes no points today", () => {
    expect(scoreAcademicPriority({ ...base("high"), hoursUntilDue: 0.1 })).toEqual(
      scoreAcademicPriority({ ...base("high"), hoursUntilDue: 23.9 }),
    );
  });

  it("an overdue low-stakes item still outranks a due-this-week high-stakes one (urgency first)", () => {
    const overdue = scoreAcademicPriority(base("critical")).score;
    const weekWithEverything = scoreAcademicPriority({
      ...base("medium"),
      missing: true,
      late: true,
      pointsPossible: 500,
    }).score;
    expect(overdue).toBeGreaterThan(weekWithEverything);
  });
});

describe("rankAcademicPriorities -- total order", () => {
  let counter = 0;
  function candidate(
    score: number,
    dueAt: string | null,
    title = "T",
    id?: string,
  ): AcademicPriorityCandidate {
    counter += 1;
    return {
      id: id ?? `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
      title,
      dueAt: dueAt === null ? null : iso(dueAt),
      score,
    };
  }

  it("orders by score desc, then due_at asc (nulls last), then title, then id", () => {
    const lowScoreEarly = candidate(100, "2026-09-17T12:00:00Z");
    const highScoreLate = candidate(400, "2026-09-20T12:00:00Z");
    const highScoreEarly = candidate(400, "2026-09-18T12:00:00Z");
    const highScoreUndated = candidate(400, null);
    const sameDueB = candidate(400, "2026-09-18T12:00:00Z", "B");
    const sameDueA = candidate(400, "2026-09-18T12:00:00Z", "A");
    const sameAllLowerId = candidate(
      400,
      "2026-09-18T12:00:00Z",
      "A",
      "00000000-0000-4000-8000-000000000000",
    );
    const ranked = rankAcademicPriorities([
      lowScoreEarly,
      highScoreLate,
      highScoreEarly,
      highScoreUndated,
      sameDueB,
      sameDueA,
      sameAllLowerId,
    ]);
    expect(ranked.map((c) => c.id)).toEqual([
      sameAllLowerId.id,
      sameDueA.id,
      sameDueB.id,
      highScoreEarly.id,
      highScoreLate.id,
      highScoreUndated.id,
      lowScoreEarly.id,
    ]);
  });

  it("is independent of input order and never mutates the input", () => {
    const a = candidate(300, "2026-09-17T12:00:00Z", "a");
    const b = candidate(200, "2026-09-17T12:00:00Z", "b");
    const c = candidate(300, "2026-09-16T12:00:00Z", "c");
    const input = [a, b, c];
    const snapshot = [...input];
    const forward = rankAcademicPriorities(input);
    const reverse = rankAcademicPriorities([c, b, a]);
    expect(forward.map((x) => x.id)).toEqual(reverse.map((x) => x.id));
    expect(forward.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(input).toEqual(snapshot);
  });

  it("the comparator is antisymmetric and returns 0 only for the same id", () => {
    const x = candidate(300, "2026-09-17T12:00:00Z", "a");
    const y = candidate(300, "2026-09-17T12:00:00Z", "a");
    expect(compareAcademicPriorities(x, y)).toBe(-compareAcademicPriorities(y, x));
    expect(compareAcademicPriorities(x, x)).toBe(0);
    expect(compareAcademicPriorities(x, y)).not.toBe(0);
  });
});

describe("deriveWorkloadStatus", () => {
  it("behind when anything is overdue OR missing, whatever else is true", () => {
    expect(deriveWorkloadStatus({ overdueTotal: 1, missingTotal: 0, dueWithin24hTotal: 0 })).toBe(
      "behind",
    );
    expect(deriveWorkloadStatus({ overdueTotal: 0, missingTotal: 1, dueWithin24hTotal: 0 })).toBe(
      "behind",
    );
    expect(deriveWorkloadStatus({ overdueTotal: 2, missingTotal: 3, dueWithin24hTotal: 4 })).toBe(
      "behind",
    );
  });

  it("at_risk when nothing is behind but something is due within 24h", () => {
    expect(deriveWorkloadStatus({ overdueTotal: 0, missingTotal: 0, dueWithin24hTotal: 1 })).toBe(
      "at_risk",
    );
  });

  it("on_track otherwise", () => {
    expect(deriveWorkloadStatus({ overdueTotal: 0, missingTotal: 0, dueWithin24hTotal: 0 })).toBe(
      "on_track",
    );
  });
});

describe("deriveCourseAttention", () => {
  const input = (overrides: Partial<Parameters<typeof deriveCourseAttention>[0]>) => ({
    overdueTotal: 0,
    dueWithin24hTotal: 0,
    dueThisWeekTotal: 0,
    openTotal: 0,
    ...overrides,
  });

  it("high when anything is overdue or due within 24h", () => {
    expect(deriveCourseAttention(input({ overdueTotal: 1, openTotal: 1 }))).toBe("high");
    expect(deriveCourseAttention(input({ dueWithin24hTotal: 1, openTotal: 1 }))).toBe("high");
    expect(
      deriveCourseAttention(input({ overdueTotal: 1, dueThisWeekTotal: 5, openTotal: 9 })),
    ).toBe("high");
  });

  it("medium when something is due this week but nothing sooner", () => {
    expect(deriveCourseAttention(input({ dueThisWeekTotal: 1, openTotal: 1 }))).toBe("medium");
  });

  it("low when something is open but nothing is due within the horizon", () => {
    expect(deriveCourseAttention(input({ openTotal: 3 }))).toBe("low");
  });

  it("none when nothing is open", () => {
    expect(deriveCourseAttention(input({}))).toBe("none");
  });

  it("ranks high before medium before low before none", () => {
    expect(["none", "low", "medium", "high"].map((l) => courseAttentionRank(l as never))).toEqual([
      3, 2, 1, 0,
    ]);
  });
});
