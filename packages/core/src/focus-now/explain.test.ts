import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "../academic/buckets.js";
import {
  ACADEMIC_PRIORITY_POINTS,
  ACADEMIC_PRIORITY_REASONS,
  ACADEMIC_URGENCY_BASE_POINTS,
} from "../academic/urgency.js";
import {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_CONTEXT_REASONS,
  FOCUS_NOW_EQUATION_TERM,
  FOCUS_NOW_REASON_LABEL,
  FOCUS_NOW_REASON_ORDER,
  FOCUS_NOW_REASON_WHY,
  FOCUS_NOW_SOURCES,
  explainFocusNowCandidate,
  explainFocusNowReason,
  focusNowEquation,
  sortReasons,
  type FocusNowReason,
} from "./explain.js";
import {
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  mergeLinkedCandidates,
  type FocusNowCandidate,
} from "./score.js";

const TZ = "America/Chicago";
const HOUR = 60 * 60 * 1000;
// 2026-09-16 14:00 CDT, the shared fixture.
const NOW = new Date("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const { horizonEndUtc: HORIZON } = academicTodayWindows(TZ, NOW);

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

describe("the closed vocabulary (reasons.ts, re-exported)", () => {
  it("is exactly academic's six, then top_priority, then the six context reasons, in that order", () => {
    expect(FOCUS_NOW_REASON_ORDER).toEqual([
      ...ACADEMIC_PRIORITY_REASONS,
      "top_priority",
      ...FOCUS_NOW_CONTEXT_REASONS,
    ]);
    expect(FOCUS_NOW_CONTEXT_REASONS).toEqual([
      "linked_assignment",
      "project_stalled",
      "course_attention_high",
      "no_submission",
      "reminder_set",
      "snoozed",
    ]);
    expect(new Set(FOCUS_NOW_REASON_ORDER).size).toBe(FOCUS_NOW_REASON_ORDER.length);
  });

  it("carries the frozen context point table: three +25 bonuses, three zeros", () => {
    expect(FOCUS_NOW_CONTEXT_POINTS).toEqual({
      linked_assignment: 25,
      project_stalled: 25,
      course_attention_high: 25,
      no_submission: 0,
      reminder_set: 0,
      snoozed: 0,
    });
    // The bonus is one additive reason's worth, never an urgency rung (ADR-071's scale).
    expect(FOCUS_NOW_CONTEXT_POINTS.linked_assignment).toBe(ACADEMIC_PRIORITY_POINTS.marked_late);
    expect(FOCUS_NOW_CONTEXT_POINTS.linked_assignment).toBe(FOCUS_NOW_TOP_PRIORITY_POINTS);
  });

  it("closes the source vocabulary", () => {
    expect(FOCUS_NOW_SOURCES).toEqual([
      "task",
      "reminder",
      "project",
      "canvas_assignment",
      "course",
      "calendar",
    ]);
  });

  it("has a label, a why and an equation term entry for every reason, and nothing else", () => {
    const keys = [...FOCUS_NOW_REASON_ORDER].sort();
    expect(Object.keys(FOCUS_NOW_REASON_LABEL).sort()).toEqual(keys);
    expect(Object.keys(FOCUS_NOW_REASON_WHY).sort()).toEqual(keys);
    expect(Object.keys(FOCUS_NOW_EQUATION_TERM).sort()).toEqual(keys);
  });

  it("gives an equation term to exactly the point-carrying reasons", () => {
    for (const reason of FOCUS_NOW_REASON_ORDER) {
      const points =
        reason === "top_priority"
          ? FOCUS_NOW_TOP_PRIORITY_POINTS
          : ((FOCUS_NOW_CONTEXT_POINTS as Record<string, number>)[reason] ??
            (ACADEMIC_PRIORITY_POINTS as Record<string, number>)[reason]);
      expect(points).toBeTypeOf("number");
      expect(FOCUS_NOW_EQUATION_TERM[reason] === null).toBe(points === 0);
    }
  });
});

describe("sortReasons", () => {
  it("dedupes and orders by the frozen vocabulary, returning a new array", () => {
    const input: FocusNowReason[] = [
      "snoozed",
      "top_priority",
      "overdue",
      "linked_assignment",
      "overdue",
      "high_points",
    ];
    const sorted = sortReasons(input);
    expect(sorted).toEqual([
      "overdue",
      "high_points",
      "top_priority",
      "linked_assignment",
      "snoozed",
    ]);
    expect(sorted).not.toBe(input);
    expect(input).toHaveLength(6);
  });

  it("is idempotent", () => {
    const once = sortReasons(["reminder_set", "due_this_week"]);
    expect(sortReasons(once)).toEqual(once);
  });
});

describe("explainFocusNowReason -- labels, sentences and sources", () => {
  it("uses the client's own seven chip words for the pre-10.6 reasons", () => {
    // Pinned literally: apps/mobile/src/components/today/focus-now-reason-chip.ts.
    expect(FOCUS_NOW_REASON_LABEL).toMatchObject({
      overdue: "Overdue",
      due_within_24h: "Due <24h",
      due_this_week: "This week",
      marked_missing: "Missing",
      marked_late: "Late",
      high_points: "High points",
      top_priority: "P1",
    });
  });

  it("names the six context reasons", () => {
    expect(FOCUS_NOW_REASON_LABEL).toMatchObject({
      linked_assignment: "Linked assignment",
      project_stalled: "Project stalled",
      course_attention_high: "Course needs attention",
      no_submission: "Not submitted",
      reminder_set: "Reminder set",
      snoozed: "Snoozed",
    });
  });

  it("resolves an urgency reason's source from the ROW's kind", () => {
    expect(explainFocusNowReason("overdue", "task")).toEqual({
      reason: "overdue",
      label: "Overdue",
      why: "Past its due time",
      source: "task",
    });
    expect(explainFocusNowReason("overdue", "academic_assignment").source).toBe(
      "canvas_assignment",
    );
    expect(explainFocusNowReason("due_within_24h", "event").source).toBe("task");
    expect(explainFocusNowReason("due_this_week", "academic_assignment").source).toBe(
      "canvas_assignment",
    );
  });

  it("gives every non-urgency reason its one fixed source, whatever the kind", () => {
    const expected: Record<string, string> = {
      marked_missing: "canvas_assignment",
      marked_late: "canvas_assignment",
      high_points: "canvas_assignment",
      no_submission: "canvas_assignment",
      top_priority: "task",
      linked_assignment: "canvas_assignment",
      project_stalled: "project",
      course_attention_high: "course",
      reminder_set: "reminder",
      snoozed: "reminder",
    };
    for (const [reason, source] of Object.entries(expected)) {
      expect(explainFocusNowReason(reason as FocusNowReason, "task").source).toBe(source);
      expect(explainFocusNowReason(reason as FocusNowReason, "academic_assignment").source).toBe(
        source,
      );
    }
  });

  it("carries the deterministic sentence for each reason", () => {
    expect(FOCUS_NOW_REASON_WHY).toEqual({
      overdue: "Past its due time",
      due_within_24h: "Due within 24 hours",
      due_this_week: "Due this week",
      marked_missing: "Canvas marked it missing",
      marked_late: "Canvas marked it late",
      high_points: "Worth 50 points or more",
      top_priority: "Marked P1",
      linked_assignment: "You linked a task to this assignment",
      project_stalled: "Its project has had no activity for 14 days",
      course_attention_high: "This course has overdue or imminent work",
      no_submission: "No submission recorded in Canvas",
      reminder_set: "A reminder is scheduled",
      snoozed: "Snoozed to a later time",
    });
  });
});

describe("focusNowEquation -- auditable from the frozen tables", () => {
  it("decomposes a task: urgency base + P1 + context bonus = score", () => {
    const merged = mergeLinkedCandidates([
      focusNowCandidateFromTask(
        { id: "t", title: "T", dueAt: plus(-1), priority: 1, canvasAssignmentId: "a" },
        NOW,
        HORIZON,
      ),
      focusNowCandidateFromAcademic({
        id: "a",
        title: "A",
        dueAt: plus(HOUR),
        score: 300,
        reasons: ["due_within_24h"],
      }),
    ]);
    // The merged base (425) is reproducible from the union of base reasons
    // only when the tables sum to it; here overdue + due_within_24h + P1 =
    // 725 ≠ 425, so the base is reported honestly as the opaque form.
    expect(focusNowEquation(merged[0]!)).toBe("425 Canvas priority + 25 linked assignment = 450");

    const plain = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: plus(-1), priority: 1, projectStalled: true },
      NOW,
      HORIZON,
    );
    expect(focusNowEquation(plain)).toBe("400 overdue + 25 P1 + 25 project stalled = 450");
  });

  it("names the low floor when a task carries no urgency reason", () => {
    const undated = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: null, priority: null },
      NOW,
      HORIZON,
    );
    expect(focusNowEquation(undated)).toBe(`${ACADEMIC_URGENCY_BASE_POINTS.low} base = 100`);
    const undatedP1 = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: null, priority: 1 },
      NOW,
      HORIZON,
    );
    expect(focusNowEquation(undatedP1)).toBe("100 base + 25 P1 = 125");
  });

  it("never decomposes an academic base -- the server's score is verbatim", () => {
    const academic = focusNowCandidateFromAcademic({
      id: "a",
      title: "A",
      dueAt: plus(-HOUR),
      score: 450,
      reasons: ["overdue", "marked_missing"],
      courseAttentionHigh: true,
      submissionUnsubmitted: true,
    });
    expect(focusNowEquation(academic)).toBe("450 Canvas priority + 25 course attention = 475");
  });

  it("omits zero-point reasons from the equation entirely", () => {
    const snoozedReminder = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: plus(-1), priority: null, remindAt: NOW, snoozedUntil: NOW },
      NOW,
      HORIZON,
    );
    expect(snoozedReminder.reasons).toEqual(["overdue", "reminder_set", "snoozed"]);
    expect(focusNowEquation(snoozedReminder)).toBe("400 overdue = 400");
  });

  it("decomposes a merged row when the union of base reasons does sum to its base", () => {
    const merged = mergeLinkedCandidates([
      c({
        id: "t",
        kind: "task",
        baseScore: 400,
        score: 400,
        reasons: ["overdue"],
        linkedAssignmentId: "a",
      }),
      c({ id: "a", kind: "academic_assignment", baseScore: 400, score: 400, reasons: ["overdue"] }),
    ]);
    expect(focusNowEquation(merged[0]!)).toBe("400 overdue + 25 linked assignment = 425");
  });

  it("always ends in the candidate's own score, whatever the terms", () => {
    for (const candidate of [
      c({ score: 100 }),
      c({ kind: "academic_assignment", baseScore: 999, score: 999 }),
      c({
        baseScore: 425,
        contextPoints: 25,
        score: 450,
        reasons: ["overdue", "top_priority", "project_stalled"],
      }),
    ]) {
      expect(focusNowEquation(candidate).endsWith(`= ${candidate.score}`)).toBe(true);
    }
  });
});

describe("explainFocusNowCandidate", () => {
  it("explains every reason in vocabulary order with the urgency as primary, plus the equation", () => {
    const candidate = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: plus(-1), priority: 1, projectStalled: true, remindAt: NOW },
      NOW,
      HORIZON,
    );
    const explained = explainFocusNowCandidate(candidate);
    expect(explained.primary).toEqual({
      reason: "overdue",
      label: "Overdue",
      why: "Past its due time",
      source: "task",
    });
    expect(explained.explanations.map((e) => e.reason)).toEqual([
      "overdue",
      "top_priority",
      "project_stalled",
      "reminder_set",
    ]);
    expect(explained.explanations.map((e) => e.source)).toEqual([
      "task",
      "task",
      "project",
      "reminder",
    ]);
    expect(explained.equation).toBe("400 overdue + 25 P1 + 25 project stalled = 450");
  });

  it("re-sorts a caller-assembled reasons list so the output is byte-identical", () => {
    const shuffled = c({
      reasons: ["snoozed", "overdue", "top_priority"],
      baseScore: 425,
      score: 425,
    });
    const ordered = c({
      reasons: ["overdue", "top_priority", "snoozed"],
      baseScore: 425,
      score: 425,
    });
    expect(explainFocusNowCandidate(shuffled)).toEqual(explainFocusNowCandidate(ordered));
  });

  it("has a null primary, an empty list and the floor equation for a row with no reason at all", () => {
    const explained = explainFocusNowCandidate(c({ score: 100 }));
    expect(explained).toEqual({ primary: null, explanations: [], equation: "100 base = 100" });
  });

  it("sources an academic row's urgency to Canvas", () => {
    const explained = explainFocusNowCandidate(
      c({ kind: "academic_assignment", reasons: ["due_within_24h", "no_submission"], score: 300 }),
    );
    expect(explained.primary?.source).toBe("canvas_assignment");
    expect(explained.explanations[1]).toEqual({
      reason: "no_submission",
      label: "Not submitted",
      why: "No submission recorded in Canvas",
      source: "canvas_assignment",
    });
  });
});
