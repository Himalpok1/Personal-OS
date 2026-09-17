import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "../academic/buckets.js";
import {
  FOCUS_NOW_CAP,
  FOCUS_NOW_TASK_REASON,
  FOCUS_NOW_TOP_PRIORITY,
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  compareFocusNowCandidates,
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  mergeLinkedCandidates,
  rankFocusNowCandidates,
  scoreFocusNowTask,
  type FocusNowCandidate,
} from "./score.js";

const TZ = "America/Chicago";
const iso = (value: string): Date => new Date(value);
const HOUR = 60 * 60 * 1000;
// Same fixture academic/urgency.test.ts uses: 2026-09-16 14:00 CDT, today's
// window [05:00Z 09-16, 05:00Z 09-17), 7-day horizon ending 05:00Z 09-24.
const NOW = iso("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const { horizonEndUtc: HORIZON } = academicTodayWindows(TZ, NOW);

function task(overrides: Partial<Parameters<typeof scoreFocusNowTask>[0]> = {}) {
  return { id: "t1", title: "Task", dueAt: null, priority: null, ...overrides };
}

describe("scoreFocusNowTask -- the urgency ladder, reused not reimplemented", () => {
  it("is critical (and 'overdue') when overdue, at the base 400 points", () => {
    const result = scoreFocusNowTask(task({ dueAt: plus(-1) }), NOW, HORIZON);
    expect(result).toEqual({
      urgency: "critical",
      baseScore: 400,
      contextPoints: 0,
      score: 400,
      reasons: ["overdue"],
    });
  });

  it("is high (and 'due_within_24h') at exactly effectiveNow and just under 24h out", () => {
    expect(scoreFocusNowTask(task({ dueAt: NOW }), NOW, HORIZON)).toMatchObject({
      urgency: "high",
      score: 300,
      reasons: ["due_within_24h"],
    });
    expect(scoreFocusNowTask(task({ dueAt: plus(24 * HOUR - 1) }), NOW, HORIZON)).toMatchObject({
      urgency: "high",
      score: 300,
    });
  });

  it("is medium (and 'due_this_week') at exactly 24h out, up to (not including) the horizon", () => {
    expect(scoreFocusNowTask(task({ dueAt: plus(24 * HOUR) }), NOW, HORIZON)).toMatchObject({
      urgency: "medium",
      score: 200,
      reasons: ["due_this_week"],
    });
    expect(
      scoreFocusNowTask(task({ dueAt: new Date(HORIZON.getTime() - 1) }), NOW, HORIZON),
    ).toMatchObject({ urgency: "medium", score: 200 });
  });

  it("is low, with no urgency reason, at or beyond the horizon end", () => {
    expect(scoreFocusNowTask(task({ dueAt: HORIZON }), NOW, HORIZON)).toEqual({
      urgency: "low",
      baseScore: 100,
      contextPoints: 0,
      score: 100,
      reasons: [],
    });
  });

  it("is low for an undated task -- undated is never urgent, mirroring academic's own rule", () => {
    expect(scoreFocusNowTask(task({ dueAt: null }), NOW, HORIZON)).toEqual({
      urgency: "low",
      baseScore: 100,
      contextPoints: 0,
      score: 100,
      reasons: [],
    });
  });

  it("adds top_priority points only at the top rung (P1), never below it", () => {
    expect(FOCUS_NOW_TOP_PRIORITY).toBe(1);
    expect(FOCUS_NOW_TOP_PRIORITY_POINTS).toBe(25);
    const withP1 = scoreFocusNowTask(task({ dueAt: plus(-1), priority: 1 }), NOW, HORIZON);
    expect(withP1).toEqual({
      urgency: "critical",
      baseScore: 425,
      contextPoints: 0,
      score: 425,
      reasons: ["overdue", "top_priority"],
    });

    const withP2 = scoreFocusNowTask(task({ dueAt: plus(-1), priority: 2 }), NOW, HORIZON);
    expect(withP2).toEqual({
      urgency: "critical",
      baseScore: 400,
      contextPoints: 0,
      score: 400,
      reasons: ["overdue"],
    });

    const withNullPriority = scoreFocusNowTask(
      task({ dueAt: plus(-1), priority: null }),
      NOW,
      HORIZON,
    );
    expect(withNullPriority.reasons).not.toContain(FOCUS_NOW_TASK_REASON);
  });

  it("adds top_priority even at the low urgency floor, for an undated P1 task", () => {
    expect(scoreFocusNowTask(task({ dueAt: null, priority: 1 }), NOW, HORIZON)).toEqual({
      urgency: "low",
      baseScore: 125,
      contextPoints: 0,
      score: 125,
      reasons: ["top_priority"],
    });
  });
});

describe("focusNowCandidateFromTask", () => {
  it("carries the task's id/title/dueAt alongside the derived score and reasons", () => {
    const candidate = focusNowCandidateFromTask(
      { id: "task-1", title: "Call the insurance guy", dueAt: plus(-1), priority: 1 },
      NOW,
      HORIZON,
    );
    expect(candidate).toEqual({
      id: "task-1",
      kind: "task",
      title: "Call the insurance guy",
      dueAt: plus(-1),
      baseScore: 425,
      contextPoints: 0,
      score: 425,
      reasons: ["overdue", "top_priority"],
      linkedAssignmentId: null,
    });
  });
});

describe("focusNowCandidateFromAcademic -- never re-derives, only wraps", () => {
  it("copies score and reasons verbatim, never recomputing them", () => {
    const candidate = focusNowCandidateFromAcademic({
      id: "assignment-1",
      title: "Project milestone 2",
      dueAt: plus(-2 * HOUR),
      score: 450,
      reasons: ["overdue", "marked_missing"],
    });
    expect(candidate).toEqual({
      id: "assignment-1",
      kind: "academic_assignment",
      title: "Project milestone 2",
      dueAt: plus(-2 * HOUR),
      baseScore: 450,
      contextPoints: 0,
      score: 450,
      reasons: ["overdue", "marked_missing"],
      linkedAssignmentId: null,
    });
  });

  it("defensively copies the reasons array rather than aliasing the caller's", () => {
    const reasons = ["due_within_24h"] as const;
    const candidate = focusNowCandidateFromAcademic({
      id: "a",
      title: "t",
      dueAt: null,
      score: 300,
      reasons,
    });
    expect(candidate.reasons).not.toBe(reasons);
    expect(candidate.reasons).toEqual(["due_within_24h"]);
  });
});

/** A minimal candidate fixture shared by the ranking tests below. */
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

describe("compareFocusNowCandidates / rankFocusNowCandidates -- one total order across domains", () => {
  it("orders by score descending first, regardless of kind", () => {
    const low = c({ id: "low", score: 100 });
    const high = c({ id: "high", kind: "academic_assignment", score: 450 });
    expect(rankFocusNowCandidates([low, high])).toEqual([high, low]);
  });

  it("breaks a score tie by dueAt ascending, nulls last", () => {
    const undated = c({ id: "undated", score: 200, dueAt: null });
    const soon = c({ id: "soon", score: 200, dueAt: plus(HOUR) });
    const sooner = c({ id: "sooner", score: 200, dueAt: NOW });
    expect(rankFocusNowCandidates([undated, soon, sooner]).map((x) => x.id)).toEqual([
      "sooner",
      "soon",
      "undated",
    ]);
  });

  it("breaks a score+dueAt tie by title ascending, then id ascending", () => {
    const b = c({ id: "id-b", title: "Bravo", score: 200, dueAt: NOW });
    const a1 = c({ id: "id-2", title: "Alpha", score: 200, dueAt: NOW });
    const a2 = c({ id: "id-1", title: "Alpha", score: 200, dueAt: NOW });
    expect(rankFocusNowCandidates([b, a1, a2]).map((x) => x.id)).toEqual(["id-1", "id-2", "id-b"]);
  });

  it("never mutates the input array", () => {
    const items = [c({ id: "a", score: 100 }), c({ id: "b", score: 200 })];
    const ranked = rankFocusNowCandidates(items);
    expect(ranked).not.toBe(items);
    expect(items.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("is exactly academic's own comparator, re-exported rather than copied", () => {
    const items = [c({ id: "a", score: 100 }), c({ id: "b", score: 200 })];
    expect([...items].sort(compareFocusNowCandidates)).toEqual(rankFocusNowCandidates(items));
  });

  it("ranks a richer row type that merely extends the candidate shape", () => {
    interface Row extends FocusNowCandidate {
      origin: "server" | "client";
    }
    const rows: Row[] = [
      { ...c({ id: "a", score: 100 }), origin: "client" },
      { ...c({ id: "b", score: 300 }), origin: "server" },
    ];
    expect(rankFocusNowCandidates(rows).map((r) => r.origin)).toEqual(["server", "client"]);
  });
});

describe("FOCUS_NOW_CAP", () => {
  it("is the documented top-5 cap, applied by the caller via slice", () => {
    expect(FOCUS_NOW_CAP).toBe(5);
    const many = Array.from({ length: 8 }, (_, i) => c({ id: `x${i}`, score: 8 - i }));
    const capped = rankFocusNowCandidates(many).slice(0, FOCUS_NOW_CAP);
    expect(capped).toHaveLength(FOCUS_NOW_CAP);
    expect(capped.map((x) => x.id)).toEqual(["x0", "x1", "x2", "x3", "x4"]);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 10.6 (ADR-075): context reasons and the linked-assignment dedupe
// ---------------------------------------------------------------------------

describe("scoreFocusNowTask -- context reasons (ADR-075)", () => {
  it("adds project_stalled (+25) as context, separate from the base", () => {
    const result = scoreFocusNowTask(
      task({ dueAt: plus(-1), priority: 1, projectStalled: true }),
      NOW,
      HORIZON,
    );
    expect(result).toEqual({
      urgency: "critical",
      baseScore: 425,
      contextPoints: 25,
      score: 450,
      reasons: ["overdue", "top_priority", "project_stalled"],
    });
  });

  it("adds reminder_set and snoozed as ZERO-point, informational reasons", () => {
    const result = scoreFocusNowTask(
      task({ dueAt: plus(-1), remindAt: plus(HOUR), snoozedUntil: plus(2 * HOUR) }),
      NOW,
      HORIZON,
    );
    expect(result).toEqual({
      urgency: "critical",
      baseScore: 400,
      contextPoints: 0,
      score: 400,
      reasons: ["overdue", "reminder_set", "snoozed"],
    });
  });

  it("treats an absent, undefined or null context field identically (no reason)", () => {
    const absent = scoreFocusNowTask(task({ dueAt: plus(-1) }), NOW, HORIZON);
    const explicit = scoreFocusNowTask(
      task({ dueAt: plus(-1), remindAt: null, snoozedUntil: null, projectStalled: false }),
      NOW,
      HORIZON,
    );
    expect(explicit).toEqual(absent);
    expect(absent.reasons).toEqual(["overdue"]);
  });

  it("orders reasons by the frozen vocabulary regardless of which flags are set", () => {
    const result = scoreFocusNowTask(
      task({ dueAt: null, priority: 1, snoozedUntil: plus(HOUR), projectStalled: true }),
      NOW,
      HORIZON,
    );
    expect(result.reasons).toEqual(["top_priority", "project_stalled", "snoozed"]);
    expect(result.score).toBe(150);
  });
});

describe("focusNowCandidateFromTask -- carries the link", () => {
  it("copies canvasAssignmentId onto linkedAssignmentId, null when absent", () => {
    const linked = focusNowCandidateFromTask(
      task({ dueAt: plus(-1), canvasAssignmentId: "asg-1" }),
      NOW,
      HORIZON,
    );
    expect(linked.linkedAssignmentId).toBe("asg-1");
    expect(linked.reasons).toEqual(["overdue"]); // the link alone is not a reason
    expect(focusNowCandidateFromTask(task(), NOW, HORIZON).linkedAssignmentId).toBeNull();
    expect(
      focusNowCandidateFromTask(task({ canvasAssignmentId: null }), NOW, HORIZON)
        .linkedAssignmentId,
    ).toBeNull();
  });
});

describe("focusNowCandidateFromAcademic -- context on top of a verbatim base", () => {
  it("keeps the server's score as baseScore and adds course_attention_high (+25) separately", () => {
    const candidate = focusNowCandidateFromAcademic({
      id: "a",
      title: "t",
      dueAt: null,
      score: 450,
      reasons: ["overdue", "marked_missing"],
      courseAttentionHigh: true,
      submissionUnsubmitted: true,
    });
    expect(candidate).toEqual({
      id: "a",
      kind: "academic_assignment",
      title: "t",
      dueAt: null,
      baseScore: 450,
      contextPoints: 25,
      score: 475,
      reasons: ["overdue", "marked_missing", "course_attention_high", "no_submission"],
      linkedAssignmentId: null,
    });
  });

  it("adds no_submission as a zero-point reason on its own", () => {
    const candidate = focusNowCandidateFromAcademic({
      id: "a",
      title: "t",
      dueAt: null,
      score: 300,
      reasons: ["due_within_24h"],
      submissionUnsubmitted: true,
    });
    expect(candidate.score).toBe(300);
    expect(candidate.contextPoints).toBe(0);
    expect(candidate.reasons).toEqual(["due_within_24h", "no_submission"]);
  });
});

describe("mergeLinkedCandidates -- a task linked to an assignment in the list is ONE row", () => {
  const assignment = (overrides: Partial<FocusNowCandidate> = {}): FocusNowCandidate =>
    c({
      id: "asg-1",
      kind: "academic_assignment",
      title: "Project milestone 2",
      dueAt: plus(3 * HOUR),
      baseScore: 350,
      contextPoints: 25,
      score: 375,
      reasons: ["due_within_24h", "high_points", "course_attention_high"],
      ...overrides,
    });
  const linkedTask = (overrides: Partial<FocusNowCandidate> = {}): FocusNowCandidate =>
    c({
      id: "task-1",
      kind: "task",
      title: "Finish milestone 2 write-up",
      dueAt: plus(-HOUR),
      baseScore: 425,
      contextPoints: 0,
      score: 425,
      reasons: ["overdue", "top_priority"],
      linkedAssignmentId: "asg-1",
      ...overrides,
    });

  it("collapses the pair into a task row: task identity, stronger base, summed context + linked bonus, union of reasons", () => {
    const merged = mergeLinkedCandidates([linkedTask(), assignment()]);
    expect(merged).toEqual([
      {
        id: "task-1",
        kind: "task",
        title: "Finish milestone 2 write-up",
        dueAt: plus(-HOUR),
        baseScore: 425,
        contextPoints: 50,
        score: 475,
        reasons: [
          "overdue",
          "due_within_24h",
          "high_points",
          "top_priority",
          "linked_assignment",
          "course_attention_high",
        ],
        linkedAssignmentId: "asg-1",
      },
    ]);
  });

  it("takes the academic base when it is the stronger one", () => {
    const merged = mergeLinkedCandidates([
      linkedTask({ baseScore: 300, score: 300, reasons: ["due_within_24h"] }),
      assignment({
        baseScore: 450,
        contextPoints: 0,
        score: 450,
        reasons: ["overdue", "marked_missing"],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ baseScore: 450, contextPoints: 25, score: 475 });
  });

  it("falls back to the assignment's dueAt when the task is undated", () => {
    const merged = mergeLinkedCandidates([linkedTask({ dueAt: null }), assignment()]);
    expect(merged[0]?.dueAt).toEqual(plus(3 * HOUR));
  });

  it("leaves a task whose link names an assignment NOT in the list unchanged -- no reason, no bonus", () => {
    const stranger = linkedTask({ linkedAssignmentId: "asg-elsewhere" });
    const other = assignment();
    const merged = mergeLinkedCandidates([stranger, other]);
    expect(merged).toEqual([stranger, other]);
    expect(merged[0]?.reasons).not.toContain("linked_assignment");
  });

  it("leaves unlinked rows untouched, in their input positions, and never mutates the input", () => {
    const first = c({ id: "unlinked-1", score: 100 });
    const t = linkedTask();
    const a = assignment();
    const last = c({ id: "unlinked-2", kind: "academic_assignment", score: 200 });
    const input = [first, a, t, last];
    const snapshot = structuredClone(input);
    const merged = mergeLinkedCandidates(input);
    expect(merged.map((x) => x.id)).toEqual(["unlinked-1", "task-1", "unlinked-2"]);
    expect(merged[0]).toBe(first);
    expect(merged[2]).toBe(last);
    expect(input).toEqual(snapshot);
    expect(merged).not.toBe(input);
  });

  it("merges two tasks linked to the same assignment with it, dropping the assignment once", () => {
    const merged = mergeLinkedCandidates([
      linkedTask({ id: "task-1" }),
      linkedTask({ id: "task-2", title: "Second task" }),
      assignment(),
    ]);
    expect(merged.map((x) => x.id)).toEqual(["task-1", "task-2"]);
    for (const row of merged) {
      expect(row.reasons).toContain("linked_assignment");
      expect(row.contextPoints).toBe(50);
    }
  });

  it("is a no-op for a list with no links at all", () => {
    const rows = [c({ id: "a" }), c({ id: "b", kind: "academic_assignment" })];
    expect(mergeLinkedCandidates(rows)).toEqual(rows);
  });

  it("dedupes a reason both sides carried and keeps the merged score consistent with its parts", () => {
    const merged = mergeLinkedCandidates([
      linkedTask({ reasons: ["overdue"], baseScore: 400, score: 400 }),
      assignment({ reasons: ["overdue"], baseScore: 400, contextPoints: 0, score: 400 }),
    ]);
    expect(merged[0]?.reasons).toEqual(["overdue", "linked_assignment"]);
    expect(merged[0]?.score).toBe(merged[0]!.baseScore + merged[0]!.contextPoints);
  });

  it("ranks the merged row on its combined score, ahead of an unlinked twin", () => {
    const merged = mergeLinkedCandidates([
      linkedTask(),
      assignment(),
      c({
        id: "twin",
        kind: "task",
        title: "Finish milestone 2 write-up",
        dueAt: plus(-HOUR),
        score: 425,
      }),
    ]);
    expect(rankFocusNowCandidates(merged).map((x) => x.id)).toEqual(["task-1", "twin"]);
  });
});
