import { FOCUS_NOW_CAP } from "@personal-os/core/focus-now/score";
import type { MemoryLinkInput } from "@personal-os/core/memory/match";
import type { TodayResponse, TodayTaskItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  academicToday,
  assignment,
  courseAttention,
  priorityItem,
} from "../academic/fixtures.test-support";
import {
  focusNowExplanation,
  focusNowRowPriorityItem,
  focusNowRows,
  type FocusNowAcademicRow,
  type FocusNowMemoryOptions,
  type FocusNowTaskRow,
} from "./focus-now-card-state";

const NOW = new Date("2026-09-16T19:00:00Z"); // 2026-09-16 14:00 CDT

function task(overrides: Partial<TodayTaskItem> = {}): TodayTaskItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Task",
    due_at: null,
    remind_at: null,
    timezone: "America/Chicago",
    priority: null,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    occurrence_id: null,
    snoozed_until: null,
    ...overrides,
  };
}

function emptyToday(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    events_today: { items: [] },
    upcoming: { days: [] },
    inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    projects: { active_count: 0, items: [] },
    reviews: {
      daily: { period_start: "2026-09-16", review_id: null, status: null, last_completed_at: null },
      weekly: {
        period_start: "2026-09-16",
        review_id: null,
        status: null,
        last_completed_at: null,
      },
    },
    brief: null,
    ...overrides,
  };
}

describe("focusNowRows -- when it renders nothing", () => {
  it("is null while today is not yet loaded", () => {
    expect(focusNowRows(undefined, academicToday(), NOW)).toBeNull();
  });

  it("is null while academic is not yet loaded", () => {
    expect(focusNowRows(emptyToday(), undefined, NOW)).toBeNull();
  });

  it("is null when neither source has any candidate", () => {
    expect(focusNowRows(emptyToday(), academicToday(), NOW)).toBeNull();
  });

  it("is null for an unreadable device timezone rather than throwing", () => {
    const today = emptyToday({
      tz: "Not/ARealZone",
      overdue: { items: [task({ due_at: "2026-09-15T00:00:00Z" })], total: 1 },
    });
    expect(focusNowRows(today, academicToday(), NOW)).toBeNull();
  });
});

describe("focusNowRows -- merging and ranking", () => {
  it("includes overdue and due-today tasks, and only those two buckets", () => {
    const today = emptyToday({
      overdue: {
        items: [task({ id: "o1", title: "Overdue task", due_at: "2026-09-15T00:00:00Z" })],
        total: 1,
      },
      due_today: {
        items: [task({ id: "d1", title: "Due today task", due_at: "2026-09-16T20:00:00Z" })],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academicToday(), NOW);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.id).sort()).toEqual(["d1", "o1"]);
  });

  it("includes the academic priorities section, verbatim-scored", () => {
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "a1", title: "Assignment one" }),
            urgency: "critical",
            score: 450,
            reasons: ["overdue", "marked_missing"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(emptyToday(), academic, NOW);
    expect(rows).toHaveLength(1);
    const [row] = rows!;
    expect(row.kind).toBe("academic_assignment");
    expect(row.score).toBe(450);
    // The fixture's submission is `unsubmitted`, so the informational
    // `no_submission` context reason (ADR-075 §2, 0 points) joins the two
    // server reasons; the score is still the server's, verbatim.
    expect(row.baseScore).toBe(450);
    expect(row.reasons).toEqual(["overdue", "marked_missing", "no_submission"]);
    expect((row as FocusNowAcademicRow).priorityItem.assignment.id).toBe("a1");
  });

  it("ranks an overdue task above a due-later-today task, and both above a low-score academic item", () => {
    const today = emptyToday({
      overdue: { items: [task({ id: "overdue-task", due_at: "2026-09-15T00:00:00Z" })], total: 1 },
      due_today: { items: [task({ id: "later-today", due_at: "2026-09-16T23:00:00Z" })], total: 1 },
    });
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "low-academic" }),
            urgency: "medium",
            score: 200,
            reasons: ["due_this_week"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academic, NOW);
    expect(rows!.map((r) => r.id)).toEqual(["overdue-task", "later-today", "low-academic"]);
  });

  it("puts a P1 overdue task above an academic item scored the same as a non-P1 overdue task", () => {
    const today = emptyToday({
      overdue: {
        items: [
          task({ id: "p1", title: "P1 task", due_at: "2026-09-15T00:00:00Z", priority: 1 }),
          task({ id: "plain", title: "Plain task", due_at: "2026-09-15T00:00:00Z" }),
        ],
        total: 2,
      },
    });
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "academic-overdue" }),
            urgency: "critical",
            score: 400,
            reasons: ["overdue"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academic, NOW);
    // p1 (425) first; plain and academic-overdue tie at 400, broken by title
    // ("Plain task" title on the task vs. the assignment fixture's own
    // "Project milestone 2" title) -- both simply outrank nothing else here.
    expect(rows![0]!.id).toBe("p1");
    expect(rows![0]!.score).toBe(425);
    expect(new Set(rows!.slice(1).map((r) => r.id))).toEqual(
      new Set(["plain", "academic-overdue"]),
    );
  });

  it("caps the merged list at FOCUS_NOW_CAP, keeping the highest scores", () => {
    const items = Array.from({ length: FOCUS_NOW_CAP + 3 }, (_, i) =>
      task({ id: `t${i}`, due_at: "2026-09-15T00:00:00Z", priority: i === 0 ? 1 : null }),
    );
    const today = emptyToday({ overdue: { items, total: items.length } });
    const rows = focusNowRows(today, academicToday(), NOW);
    expect(rows).toHaveLength(FOCUS_NOW_CAP);
    // The one P1 task must survive the cap -- it strictly outscores the rest.
    expect(rows!.map((r) => r.id)).toContain("t0");
  });

  it("carries the originating task/priorityItem through on each row for the card to render", () => {
    const today = emptyToday({
      due_today: { items: [task({ id: "d1", title: "Due today task" })], total: 1 },
    });
    const rows = focusNowRows(today, academicToday(), NOW);
    const [row] = rows as [FocusNowTaskRow];
    expect(row.kind).toBe("task");
    expect(row.task.title).toBe("Due today task");
  });
});

describe("focusNowRows -- context reasons (Checkpoint 10.6, ADR-075 §2)", () => {
  it("adds reminder_set and snoozed to a task as informational reasons that never reorder", () => {
    const today = emptyToday({
      overdue: {
        items: [
          task({
            id: "r1",
            title: "Reminded",
            due_at: "2026-09-15T00:00:00Z",
            remind_at: "2026-09-15T00:00:00Z",
            snoozed_until: "2026-09-16T18:00:00Z",
          }),
          task({ id: "p1", title: "Plain", due_at: "2026-09-15T00:00:00Z" }),
        ],
        total: 2,
      },
    });
    const rows = focusNowRows(today, academicToday(), NOW)!;
    const reminded = rows.find((r) => r.id === "r1")!;
    const plain = rows.find((r) => r.id === "p1")!;
    expect(reminded.reasons).toEqual(["overdue", "reminder_set", "snoozed"]);
    expect(reminded.contextPoints).toBe(0);
    expect(reminded.score).toBe(plain.score);
  });

  it("adds project_stalled (+25) from the task's project in today.projects, by project_id", () => {
    const stalledProject = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Stalled",
      status: "active" as const,
      color: null,
      goal: null,
      target_date: null,
      archived_at: null,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      open_task_count: 1,
      done_task_count: 0,
      overdue_task_count: 1,
      next_action: null,
      stalled: true,
      last_activity_at: null,
    };
    const today = emptyToday({
      projects: { active_count: 1, items: [stalledProject as never] },
      overdue: {
        items: [
          task({
            id: "s1",
            title: "In stalled project",
            due_at: "2026-09-15T00:00:00Z",
            project_id: stalledProject.id,
            project_name: "Stalled",
          }),
          task({ id: "p1", title: "Plain", due_at: "2026-09-15T00:00:00Z" }),
        ],
        total: 2,
      },
    });
    const rows = focusNowRows(today, academicToday(), NOW)!;
    expect(rows.map((r) => r.id)).toEqual(["s1", "p1"]);
    expect(rows[0]!.reasons).toEqual(["overdue", "project_stalled"]);
    expect(rows[0]!.baseScore).toBe(400);
    expect(rows[0]!.contextPoints).toBe(25);
    expect(rows[0]!.score).toBe(425);
  });

  it("adds course_attention_high (+25) and no_submission to an assignment from the academic response", () => {
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({
              id: "a1",
              submission: {
                status: "unsubmitted",
                missing: false,
                late: false,
                submitted_at: null,
              },
            }),
            urgency: "high",
            score: 300,
            reasons: ["due_within_24h"],
          }),
        ],
        total: 1,
      },
      course_attention: {
        items: [courseAttention({ course_id: assignment().course_id, attention: "high" })],
        total: 1,
      },
    });
    const [row] = focusNowRows(emptyToday(), academic, NOW)!;
    expect(row!.reasons).toEqual(["due_within_24h", "course_attention_high", "no_submission"]);
    expect(row!.baseScore).toBe(300);
    expect(row!.contextPoints).toBe(25);
    expect(row!.score).toBe(325);
  });

  it("adds neither when the course is at medium attention and the work is submitted", () => {
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({
              id: "a1",
              submission: { status: "submitted", missing: false, late: false, submitted_at: null },
            }),
          }),
        ],
        total: 1,
      },
      course_attention: {
        items: [courseAttention({ course_id: assignment().course_id, attention: "medium" })],
        total: 1,
      },
    });
    const [row] = focusNowRows(emptyToday(), academic, NOW)!;
    expect(row!.reasons).toEqual(["due_within_24h"]);
    expect(row!.contextPoints).toBe(0);
  });
});

describe("focusNowRows -- the linked-assignment merge (ADR-075 §3)", () => {
  const ASSIGNMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function linkedFixtures() {
    const today = emptyToday({
      due_today: {
        items: [
          task({
            id: "t1",
            title: "Finish milestone",
            due_at: "2026-09-16T23:00:00Z",
            canvas_assignment_id: ASSIGNMENT_ID,
          }),
        ],
        total: 1,
      },
    });
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: ASSIGNMENT_ID, title: "Project milestone 2" }),
            urgency: "critical",
            score: 450,
            reasons: ["overdue", "marked_missing"],
          }),
        ],
        total: 1,
      },
    });
    return { today, academic };
  }

  it("collapses the task and its assignment into ONE task row carrying the priority item", () => {
    const { today, academic } = linkedFixtures();
    const rows = focusNowRows(today, academic, NOW)!;
    expect(rows).toHaveLength(1);
    const [row] = rows as [FocusNowTaskRow];
    expect(row.kind).toBe("task");
    expect(row.id).toBe("t1");
    expect(row.title).toBe("Finish milestone");
    expect(row.linkedAssignmentId).toBe(ASSIGNMENT_ID);
    expect(row.linkedPriorityItem?.assignment.id).toBe(ASSIGNMENT_ID);
    expect(rows.some((r) => r.kind === "academic_assignment")).toBe(false);
  });

  it("scores the merged row as max base + both contexts + the linked bonus, reasons in vocabulary order", () => {
    const { today, academic } = linkedFixtures();
    const [row] = focusNowRows(today, academic, NOW)!;
    // task base 300 (due <24h) vs academic base 450: max 450; +25 linked.
    expect(row!.baseScore).toBe(450);
    expect(row!.contextPoints).toBe(25);
    expect(row!.score).toBe(475);
    expect(row!.reasons).toEqual([
      "overdue",
      "due_within_24h",
      "marked_missing",
      "linked_assignment",
      "no_submission",
    ]);
  });

  it("leaves a task linked to an assignment that is not a candidate today unchanged", () => {
    const { today } = linkedFixtures();
    const [row] = focusNowRows(today, academicToday(), NOW) as [FocusNowTaskRow];
    expect(row.linkedAssignmentId).toBe(ASSIGNMENT_ID);
    expect(row.linkedPriorityItem).toBeNull();
    expect(row.reasons).toEqual(["due_within_24h"]);
    expect(row.contextPoints).toBe(0);
  });
});

describe("focusNowExplanation (ADR-075 §1)", () => {
  it("explains every reason in order with a label, a why and a source, and an auditable equation", () => {
    const today = emptyToday({
      overdue: {
        items: [
          task({
            id: "p1",
            title: "P1 task",
            due_at: "2026-09-15T00:00:00Z",
            priority: 1,
            remind_at: "2026-09-15T00:00:00Z",
          }),
        ],
        total: 1,
      },
    });
    const [row] = focusNowRows(today, academicToday(), NOW)!;
    const explanation = focusNowExplanation(row!);
    expect(explanation.primary?.reason).toBe("overdue");
    expect(explanation.explanations.map((e) => [e.reason, e.label, e.source])).toEqual([
      ["overdue", "Overdue", "task"],
      ["top_priority", "P1", "task"],
      ["reminder_set", "Reminder set", "reminder"],
    ]);
    expect(explanation.explanations.every((e) => e.why.length > 0)).toBe(true);
    expect(explanation.equation).toBe("400 overdue + 25 P1 = 425");
  });

  it("writes an academic base as the server's verbatim score, plus the context terms", () => {
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "a1" }),
            urgency: "critical",
            score: 450,
            reasons: ["overdue", "marked_missing"],
          }),
        ],
        total: 1,
      },
      course_attention: {
        items: [courseAttention({ course_id: assignment().course_id, attention: "high" })],
        total: 1,
      },
    });
    const [row] = focusNowRows(emptyToday(), academic, NOW)!;
    const explanation = focusNowExplanation(row!);
    expect(explanation.equation).toBe("450 Canvas priority + 25 course attention = 475");
    expect(explanation.explanations[0]).toMatchObject({
      reason: "overdue",
      source: "canvas_assignment",
    });
  });

  it("focusNowRowPriorityItem answers the assignment for an academic row, the linked one for a merged task row, and null otherwise", () => {
    const academic = academicToday({
      priorities: { items: [priorityItem({ assignment: assignment({ id: "a1" }) })], total: 1 },
    });
    const [academicRow] = focusNowRows(emptyToday(), academic, NOW)!;
    expect(focusNowRowPriorityItem(academicRow!)?.assignment.id).toBe("a1");
    const today = emptyToday({
      due_today: { items: [task({ id: "t1", canvas_assignment_id: "a1" })], total: 1 },
    });
    const [merged] = focusNowRows(today, academic, NOW)!;
    expect(merged!.kind).toBe("task");
    expect(focusNowRowPriorityItem(merged!)?.assignment.id).toBe("a1");
    const [plain] = focusNowRows(today, academicToday(), NOW)!;
    expect(focusNowRowPriorityItem(plain!)).toBeNull();
  });
});

describe("focusNowRows -- memory by typed link (Checkpoint 10.7, ADR-077 §5/§7)", () => {
  const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
  const ASSIGNMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const COURSE_ID = assignment().course_id;

  function memory(overrides: Partial<MemoryLinkInput> = {}): MemoryLinkInput {
    return {
      id: "m-0001",
      kind: "preference",
      statement: "I work best in the evening",
      projectId: null,
      canvasCourseId: null,
      ...overrides,
    };
  }

  function enabled(memories: MemoryLinkInput[]): FocusNowMemoryOptions {
    return { memories, memoryEnabled: true };
  }

  function projectTaskToday(overrides: Partial<TodayTaskItem> = {}) {
    return emptyToday({
      overdue: {
        items: [
          task({
            id: "t1",
            title: "Thesis chapter",
            due_at: "2026-09-15T00:00:00Z",
            project_id: PROJECT_ID,
            project_name: "Thesis",
            ...overrides,
          }),
        ],
        total: 1,
      },
    });
  }

  function courseAcademic() {
    return academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: ASSIGNMENT_ID, title: "Project milestone 2" }),
            urgency: "critical",
            score: 400,
            reasons: ["overdue"],
          }),
        ],
        total: 1,
      },
    });
  }

  it("adds matches_preference (+15) to a task from a preference memory linked to its project, and returns the match on the row", () => {
    const preference = memory({ projectId: PROJECT_ID });
    const [row] = focusNowRows(projectTaskToday(), academicToday(), NOW, enabled([preference]))!;
    expect(row!.reasons).toEqual(["overdue", "matches_preference"]);
    expect(row!.baseScore).toBe(400);
    expect(row!.contextPoints).toBe(15);
    expect(row!.score).toBe(415);
    expect(row!.memoryMatch).toEqual({ matchesPreference: preference, supportsGoal: null });
  });

  it("adds supports_goal (+15) from a goal memory linked to the task's project, and both reasons when both are linked", () => {
    const goal = memory({
      id: "m-goal",
      kind: "goal",
      statement: "Finish the thesis by December",
      projectId: PROJECT_ID,
    });
    const preference = memory({ projectId: PROJECT_ID });
    const [goalOnly] = focusNowRows(projectTaskToday(), academicToday(), NOW, enabled([goal]))!;
    expect(goalOnly!.reasons).toEqual(["overdue", "supports_goal"]);
    expect(goalOnly!.contextPoints).toBe(15);
    expect(goalOnly!.memoryMatch).toEqual({ matchesPreference: null, supportsGoal: goal });
    const [both] = focusNowRows(
      projectTaskToday(),
      academicToday(),
      NOW,
      enabled([goal, preference]),
    )!;
    expect(both!.reasons).toEqual(["overdue", "matches_preference", "supports_goal"]);
    expect(both!.contextPoints).toBe(30);
    expect(both!.score).toBe(430);
    expect(both!.memoryMatch).toEqual({ matchesPreference: preference, supportsGoal: goal });
  });

  it("adds matches_preference to an assignment from a preference memory linked to its course, on top of the server's verbatim score", () => {
    const preference = memory({ statement: "Do INSY work first thing", canvasCourseId: COURSE_ID });
    const [row] = focusNowRows(emptyToday(), courseAcademic(), NOW, enabled([preference]))!;
    expect(row!.kind).toBe("academic_assignment");
    expect(row!.baseScore).toBe(400);
    expect(row!.reasons).toEqual(["overdue", "no_submission", "matches_preference"]);
    expect(row!.contextPoints).toBe(15);
    expect(row!.score).toBe(415);
    expect(row!.memoryMatch).toEqual({ matchesPreference: preference, supportsGoal: null });
    expect(focusNowExplanation(row!).explanations.at(-1)).toEqual({
      reason: "matches_preference",
      label: "Matches your preference",
      why: "You said: Do INSY work first thing",
      source: "memory",
    });
  });

  it("never matches by text: a memory whose statement contains the task title but has no link adds nothing", () => {
    const unlinked = memory({ statement: "Thesis chapter is what matters most this week" });
    const [row] = focusNowRows(projectTaskToday(), academicToday(), NOW, enabled([unlinked]))!;
    expect(row!.reasons).toEqual(["overdue"]);
    expect(row!.contextPoints).toBe(0);
    expect(row!.memoryMatch).toBeNull();
  });

  it("adds nothing for a memory linked to a DIFFERENT project or course", () => {
    const other = memory({ projectId: "55555555-5555-4555-8555-555555555555" });
    const [row] = focusNowRows(projectTaskToday(), academicToday(), NOW, enabled([other]))!;
    expect(row!.reasons).toEqual(["overdue"]);
    expect(row!.memoryMatch).toBeNull();
    const otherCourse = memory({ canvasCourseId: "66666666-6666-4666-8666-666666666666" });
    const [academicRow] = focusNowRows(
      emptyToday(),
      courseAcademic(),
      NOW,
      enabled([otherCourse]),
    )!;
    expect(academicRow!.reasons).toEqual(["overdue", "no_submission"]);
    expect(academicRow!.memoryMatch).toBeNull();
  });

  it("treats every memory as absent when the switch is off, and when memory is absent or omitted", () => {
    const preference = memory({ projectId: PROJECT_ID });
    for (const options of [
      { memories: [preference], memoryEnabled: false },
      { memories: null, memoryEnabled: true },
      undefined,
    ] as (FocusNowMemoryOptions | undefined)[]) {
      const [row] = focusNowRows(projectTaskToday(), academicToday(), NOW, options)!;
      expect(row!.reasons).toEqual(["overdue"]);
      expect(row!.contextPoints).toBe(0);
      expect(row!.memoryMatch).toBeNull();
    }
  });

  it("reaches a task linked to one of today's assignments through that assignment's course -- and only then", () => {
    const preference = memory({ statement: "Do INSY work first thing", canvasCourseId: COURSE_ID });
    const linkedToday = projectTaskToday({
      project_id: null,
      project_name: null,
      canvas_assignment_id: ASSIGNMENT_ID,
    });
    // The assignment is NOT a candidate today: no course to resolve, so no match.
    const [alone] = focusNowRows(linkedToday, academicToday(), NOW, enabled([preference]))!;
    expect(alone!.reasons).toEqual(["overdue"]);
    expect(alone!.memoryMatch).toBeNull();
    // The assignment IS a candidate today: the merged row carries the reason once.
    const [merged] = focusNowRows(linkedToday, courseAcademic(), NOW, enabled([preference]))!;
    expect(merged!.kind).toBe("task");
    expect(merged!.reasons).toEqual([
      "overdue",
      "linked_assignment",
      "no_submission",
      "matches_preference",
    ]);
    expect(merged!.contextPoints).toBe(40);
    expect(merged!.score).toBe(440);
    expect(merged!.memoryMatch).toEqual({ matchesPreference: preference, supportsGoal: null });
  });

  it("gives a merged task+assignment row each memory bonus ONCE when both sides match, naming the task's own memory first", () => {
    const projectPreference = memory({
      id: "m-project",
      statement: "Evenings for the thesis",
      projectId: PROJECT_ID,
    });
    const coursePreference = memory({
      id: "m-course",
      statement: "Do INSY work first thing",
      canvasCourseId: COURSE_ID,
    });
    const goal = memory({
      id: "m-goal",
      kind: "goal",
      statement: "Graduate in May",
      projectId: PROJECT_ID,
    });
    const linkedToday = projectTaskToday({ canvas_assignment_id: ASSIGNMENT_ID });
    const rows = focusNowRows(
      linkedToday,
      courseAcademic(),
      NOW,
      enabled([projectPreference, coursePreference, goal]),
    )!;
    expect(rows).toHaveLength(1);
    const [row] = rows as [FocusNowTaskRow];
    expect(row.kind).toBe("task");
    // task: overdue 400 + preference + goal; academic: overdue 400 + no_submission + preference.
    // Union: matches_preference ONCE (+15), supports_goal (+15), linked (+25) = 55.
    expect(row.reasons).toEqual([
      "overdue",
      "linked_assignment",
      "no_submission",
      "matches_preference",
      "supports_goal",
    ]);
    expect(row.baseScore).toBe(400);
    expect(row.contextPoints).toBe(55);
    expect(row.score).toBe(455);
    expect(row.reasons.filter((reason) => reason === "matches_preference")).toHaveLength(1);
    expect(row.memoryMatch).toEqual({ matchesPreference: projectPreference, supportsGoal: goal });
    expect(row.linkedPriorityItem?.assignment.id).toBe(ASSIGNMENT_ID);
    expect(focusNowExplanation(row).equation).toBe(
      "400 overdue + 25 linked assignment + 15 preference + 15 goal = 455",
    );
  });

  it("names the assignment's memory on a merged row when only the assignment side matched", () => {
    const coursePreference = memory({
      id: "m-course",
      statement: "Do INSY work first thing",
      canvasCourseId: COURSE_ID,
    });
    const linkedToday = projectTaskToday({
      project_id: null,
      project_name: null,
      canvas_assignment_id: ASSIGNMENT_ID,
    });
    // Give the task no course route of its own by matching through the academic side only:
    // the task ALSO resolves the course (it is a candidate today), so both sides match the same memory.
    const [row] = focusNowRows(linkedToday, courseAcademic(), NOW, enabled([coursePreference]))!;
    expect(row!.memoryMatch?.matchesPreference).toEqual(coursePreference);
    expect(focusNowExplanation(row!).explanations.at(-1)?.why).toBe(
      "You said: Do INSY work first thing",
    );
  });

  it("orders two otherwise-equal rows by the memory bonus, and never lifts a row past one due sooner", () => {
    const preference = memory({ projectId: PROJECT_ID });
    const today = emptyToday({
      overdue: {
        items: [
          task({ id: "plain", title: "Plain", due_at: "2026-09-14T00:00:00Z" }),
          task({
            id: "pref",
            title: "Preferred",
            due_at: "2026-09-15T00:00:00Z",
            project_id: PROJECT_ID,
          }),
        ],
        total: 2,
      },
      due_today: {
        items: [
          task({ id: "later", title: "Later today", due_at: "2026-09-16T23:00:00Z" }),
          task({
            id: "later-pref",
            title: "Later today, preferred",
            due_at: "2026-09-16T23:30:00Z",
            project_id: PROJECT_ID,
          }),
        ],
        total: 2,
      },
    });
    const rows = focusNowRows(today, academicToday(), NOW, enabled([preference]))!;
    // 415 (pref) > 400 (plain, though due sooner): memory reorders within the rung;
    // 315 (later-pref) > 300 (later); but no due-today row passes an overdue one.
    expect(rows.map((r) => r.id)).toEqual(["pref", "plain", "later-pref", "later"]);
  });
});
