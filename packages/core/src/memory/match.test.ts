import { describe, expect, it } from "vitest";
import { academicTodayWindows } from "../academic/buckets.js";
import {
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  rankFocusNowCandidates,
} from "../focus-now/score.js";
import {
  MEMORY_WORKING_HOURS_PATTERN,
  buildMemoryIndex,
  compareMemoryLinkInputs,
  matchMemoriesForRow,
  memoryMatchFlags,
  memoryWorkingHours,
  parseWorkingHoursStatement,
  type MemoryLinkInput,
} from "./match.js";

const TZ = "America/Chicago";
const NOW = new Date("2026-09-16T19:00:00Z");
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);
const { horizonEndUtc: HORIZON } = academicTodayWindows(TZ, NOW);

const P = "11111111-1111-4111-8111-111111111111"; // project P
const Q = "22222222-2222-4222-8222-222222222222"; // project Q
const C = "33333333-3333-4333-8333-333333333333"; // course C
const D = "44444444-4444-4444-8444-444444444444"; // course D

function m(overrides: Partial<MemoryLinkInput> & { id: string }): MemoryLinkInput {
  return {
    kind: "preference",
    statement: `Memory ${overrides.id}`,
    projectId: null,
    canvasCourseId: null,
    ...overrides,
  };
}

const ON = { enabled: true };
const OFF = { enabled: false };

describe("buildMemoryIndex / matchMemoriesForRow -- by typed link only", () => {
  it("a goal linked to project P adds supports_goal to a row in P and not to a row in Q", () => {
    const goal = m({ id: "g1", kind: "goal", statement: "Ship the capstone", projectId: P });
    const index = buildMemoryIndex([goal], ON);
    expect(matchMemoriesForRow(index, { projectId: P })).toEqual({
      matchesPreference: null,
      supportsGoal: goal,
    });
    expect(matchMemoriesForRow(index, { projectId: Q })).toEqual({
      matchesPreference: null,
      supportsGoal: null,
    });
    expect(matchMemoriesForRow(index, {})).toEqual({ matchesPreference: null, supportsGoal: null });
  });

  it("a preference linked to course C adds matches_preference to an assignment row of C only", () => {
    const pref = m({ id: "p1", kind: "preference", statement: "Do labs first", canvasCourseId: C });
    const index = buildMemoryIndex([pref], ON);
    expect(matchMemoriesForRow(index, { canvasCourseId: C })).toEqual({
      matchesPreference: pref,
      supportsGoal: null,
    });
    expect(matchMemoriesForRow(index, { canvasCourseId: D }).matchesPreference).toBeNull();
    expect(matchMemoriesForRow(index, { projectId: C }).matchesPreference).toBeNull(); // a course id is not a project id
  });

  it("a fact counts for matches_preference; a goal never does, and a preference never counts for supports_goal", () => {
    const fact = m({
      id: "f1",
      kind: "fact",
      statement: "This class grades on a curve",
      projectId: P,
    });
    const goal = m({ id: "g1", kind: "goal", projectId: P });
    const pref = m({ id: "p1", kind: "preference", projectId: Q });
    const index = buildMemoryIndex([fact, goal, pref], ON);
    expect(matchMemoriesForRow(index, { projectId: P })).toEqual({
      matchesPreference: fact,
      supportsGoal: goal,
    });
    expect(matchMemoriesForRow(index, { projectId: Q })).toEqual({
      matchesPreference: pref,
      supportsGoal: null,
    });
  });

  it("NEVER matches on text: a memory whose statement contains the row's title but has no link matches nothing", () => {
    const rowTitle = "Finish the lab report for BIOL 1442";
    const unlinked = m({
      id: "u1",
      kind: "preference",
      statement: `Always ${rowTitle} before Friday`,
    });
    const index = buildMemoryIndex([unlinked], ON);
    // The matcher cannot even receive a title; a row with links and a row without both miss.
    expect(matchMemoriesForRow(index, { projectId: P, canvasCourseId: C })).toEqual({
      matchesPreference: null,
      supportsGoal: null,
    });
    expect(index.byProject.size).toBe(0);
    expect(index.byCourse.size).toBe(0);
  });

  it("returns at most ONE memory per reason, chosen by a total order (kind, statement, id), whatever the input order", () => {
    const b = m({ id: "z-id", kind: "preference", statement: "Bravo", projectId: P });
    const a = m({ id: "y-id", kind: "preference", statement: "Alpha", projectId: P });
    const aTie = m({ id: "a-id", kind: "preference", statement: "Alpha", projectId: P });
    const fact = m({ id: "0-id", kind: "fact", statement: "AAA first by statement", projectId: P });
    const g2 = m({ id: "g2", kind: "goal", statement: "Goal two", projectId: P });
    const g1 = m({ id: "g1", kind: "goal", statement: "Goal one", projectId: P });
    const forward = buildMemoryIndex([b, a, aTie, fact, g2, g1], ON);
    const reversed = buildMemoryIndex([g1, g2, fact, aTie, a, b], ON);
    const expected = { matchesPreference: aTie, supportsGoal: g1 };
    expect(matchMemoriesForRow(forward, { projectId: P })).toEqual(expected);
    expect(matchMemoriesForRow(reversed, { projectId: P })).toEqual(expected);
    // A preference outranks a fact even when the fact's statement sorts first.
    expect(matchMemoriesForRow(forward, { projectId: P }).matchesPreference?.kind).toBe(
      "preference",
    );
  });

  it("prefers a project-linked preference over a course-linked one for the same row", () => {
    const viaCourse = m({
      id: "a-course",
      kind: "preference",
      statement: "Aaa",
      canvasCourseId: C,
    });
    const viaProject = m({ id: "z-project", kind: "preference", statement: "Zzz", projectId: P });
    const index = buildMemoryIndex([viaCourse, viaProject], ON);
    expect(matchMemoriesForRow(index, { projectId: P, canvasCourseId: C }).matchesPreference).toBe(
      viaProject,
    );
    expect(matchMemoriesForRow(index, { canvasCourseId: C }).matchesPreference).toBe(viaCourse);
  });

  it("a memory linked to both a project and a course is reachable through either", () => {
    const both = m({ id: "b1", kind: "preference", projectId: P, canvasCourseId: C });
    const index = buildMemoryIndex([both], ON);
    expect(matchMemoriesForRow(index, { projectId: P }).matchesPreference).toBe(both);
    expect(matchMemoriesForRow(index, { canvasCourseId: C }).matchesPreference).toBe(both);
  });

  it("treats null and undefined row links alike and ignores empty-string link ids", () => {
    const index = buildMemoryIndex(
      [m({ id: "e", projectId: "" }), m({ id: "p", projectId: P })],
      ON,
    );
    expect(index.byProject.has("")).toBe(false);
    expect(matchMemoriesForRow(index, { projectId: null, canvasCourseId: undefined })).toEqual({
      matchesPreference: null,
      supportsGoal: null,
    });
  });

  it("never mutates the caller's array or memories", () => {
    const memories = [
      m({ id: "2", kind: "goal", projectId: P }),
      m({ id: "1", kind: "goal", projectId: P }),
    ];
    const snapshot = structuredClone(memories);
    buildMemoryIndex(memories, ON);
    expect(memories).toEqual(snapshot);
    expect(memories.map((x) => x.id)).toEqual(["2", "1"]);
  });

  it("compareMemoryLinkInputs is a total order: kind, then statement, then id", () => {
    const pref = m({ id: "b", kind: "preference", statement: "z" });
    const goal = m({ id: "a", kind: "goal", statement: "a" });
    const fact = m({ id: "a", kind: "fact", statement: "a" });
    expect(compareMemoryLinkInputs(pref, goal)).toBeLessThan(0);
    expect(compareMemoryLinkInputs(goal, fact)).toBeLessThan(0);
    expect(
      compareMemoryLinkInputs(m({ id: "1", statement: "a" }), m({ id: "1", statement: "b" })),
    ).toBeLessThan(0);
    expect(
      compareMemoryLinkInputs(m({ id: "1", statement: "a" }), m({ id: "2", statement: "a" })),
    ).toBeLessThan(0);
    expect(compareMemoryLinkInputs(m({ id: "1" }), m({ id: "1" }))).toBe(0);
  });
});

describe("the global switch (ADR-077 §7): disabled ⇒ memories are absent", () => {
  it("a disabled index yields no match for a row that would otherwise match both reasons", () => {
    const memories = [
      m({ id: "g", kind: "goal", projectId: P }),
      m({ id: "p", kind: "preference", canvasCourseId: C }),
    ];
    const off = buildMemoryIndex(memories, OFF);
    expect(off.enabled).toBe(false);
    expect(off.byProject.size).toBe(0);
    expect(off.byCourse.size).toBe(0);
    expect(matchMemoriesForRow(off, { projectId: P, canvasCourseId: C })).toEqual({
      matchesPreference: null,
      supportsGoal: null,
    });
    expect(memoryMatchFlags(matchMemoriesForRow(off, { projectId: P, canvasCourseId: C }))).toEqual(
      {
        matchesPreference: false,
        supportsGoal: false,
      },
    );
  });

  it("disabled working hours are null even when a preference states them", () => {
    expect(
      memoryWorkingHours(
        [m({ id: "w", kind: "preference", statement: "Working hours 9-18" })],
        OFF,
      ),
    ).toBeNull();
  });

  it("a disabled index produces exactly the score a memory-less scorer produces (end to end)", () => {
    const memories = [m({ id: "g", kind: "goal", projectId: P })];
    const off = memoryMatchFlags(
      matchMemoriesForRow(buildMemoryIndex(memories, OFF), { projectId: P }),
    );
    const on = memoryMatchFlags(
      matchMemoriesForRow(buildMemoryIndex(memories, ON), { projectId: P }),
    );
    const base = { id: "t", title: "T", dueAt: plus(-1), priority: null };
    const plain = focusNowCandidateFromTask(base, NOW, HORIZON);
    expect(focusNowCandidateFromTask({ ...base, memory: off }, NOW, HORIZON)).toEqual(plain);
    const remembered = focusNowCandidateFromTask({ ...base, memory: on }, NOW, HORIZON);
    expect(remembered.reasons).toEqual(["overdue", "supports_goal"]);
    expect(remembered.score).toBe(plain.score + 15);
  });
});

describe("memoryMatchFlags → the scorer (end to end)", () => {
  it("a goal in project P adds supports_goal (+15) to a task in P and not to a task in Q", () => {
    const index = buildMemoryIndex([m({ id: "g", kind: "goal", projectId: P })], ON);
    const inP = focusNowCandidateFromTask(
      {
        id: "p",
        title: "In P",
        dueAt: plus(-1),
        priority: null,
        memory: memoryMatchFlags(matchMemoriesForRow(index, { projectId: P })),
      },
      NOW,
      HORIZON,
    );
    const inQ = focusNowCandidateFromTask(
      {
        id: "q",
        title: "In Q",
        dueAt: plus(-1),
        priority: null,
        memory: memoryMatchFlags(matchMemoriesForRow(index, { projectId: Q })),
      },
      NOW,
      HORIZON,
    );
    expect(inP).toMatchObject({
      score: 415,
      contextPoints: 15,
      reasons: ["overdue", "supports_goal"],
    });
    expect(inQ).toMatchObject({ score: 400, contextPoints: 0, reasons: ["overdue"] });
    expect(rankFocusNowCandidates([inQ, inP]).map((x) => x.id)).toEqual(["p", "q"]);
  });

  it("a preference in course C adds matches_preference to an academic row of C, on the verbatim base", () => {
    const index = buildMemoryIndex([m({ id: "p", kind: "preference", canvasCourseId: C })], ON);
    const inC = focusNowCandidateFromAcademic({
      id: "a",
      title: "A",
      dueAt: plus(60 * 60 * 1000),
      score: 300,
      reasons: ["due_within_24h"],
      memory: memoryMatchFlags(matchMemoriesForRow(index, { canvasCourseId: C })),
    });
    expect(inC).toMatchObject({
      baseScore: 300,
      contextPoints: 15,
      score: 315,
      reasons: ["due_within_24h", "matches_preference"],
    });
    const inD = focusNowCandidateFromAcademic({
      id: "b",
      title: "B",
      dueAt: null,
      score: 300,
      reasons: ["due_within_24h"],
      memory: memoryMatchFlags(matchMemoriesForRow(index, { canvasCourseId: D })),
    });
    expect(inD.score).toBe(300);
  });

  it("ten linked memories are worth exactly what one is: the bonus is capped at +15 per reason", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      m({ id: `p${i}`, kind: "preference", statement: `Pref ${i}`, projectId: P }),
    ).concat(
      Array.from({ length: 10 }, (_, i) =>
        m({ id: `g${i}`, kind: "goal", statement: `Goal ${i}`, projectId: P }),
      ),
    );
    const flags = memoryMatchFlags(
      matchMemoriesForRow(buildMemoryIndex(many, ON), { projectId: P }),
    );
    const candidate = focusNowCandidateFromTask(
      { id: "t", title: "T", dueAt: plus(-1), priority: null, memory: flags },
      NOW,
      HORIZON,
    );
    expect(candidate.contextPoints).toBe(30);
    expect(candidate.reasons).toEqual(["overdue", "matches_preference", "supports_goal"]);
  });
});

describe("memoryWorkingHours -- the one fixed grammar", () => {
  it("recognises the documented forms", () => {
    const cases: Array<[string, { dayStartHour: number; dayEndHour: number }]> = [
      ["Working hours 9-18", { dayStartHour: 9, dayEndHour: 18 }],
      ["working hours: 9 - 18", { dayStartHour: 9, dayEndHour: 18 }],
      ["Work hours 8–17", { dayStartHour: 8, dayEndHour: 17 }],
      ["Study hours: 09:00 to 21:00", { dayStartHour: 9, dayEndHour: 21 }],
      ["studying hours 10 to 22", { dayStartHour: 10, dayEndHour: 22 }],
      ["Focus hours - 7-12", { dayStartHour: 7, dayEndHour: 12 }],
      ["My FOCUS HOUR 6 to 9 is sacred", { dayStartHour: 6, dayEndHour: 9 }],
      ["I keep working hours 0-23.", { dayStartHour: 0, dayEndHour: 23 }],
    ];
    for (const [statement, expected] of cases) {
      expect(parseWorkingHoursStatement(statement), statement).toEqual(expected);
    }
  });

  it("requires the literal 'hours' token -- free prose about a working day is NOT read", () => {
    // The grammar is a fixed phrase, not an understanding of the sentence:
    // deciding which numbers in "I work 9 to 5 most days" are hours would be
    // the open-ended reading of the owner's text 10.7 forbids.
    for (const statement of [
      "I work 9 to 5 most days",
      "I usually study from 9 until 18",
      "9-18",
      "Office 9-18",
      "Working from 9 to 18",
      "working hours are flexible",
      "hours 9-18",
    ]) {
      expect(parseWorkingHoursStatement(statement), statement).toBeNull();
    }
  });

  it("rejects out-of-range hours, an inverted or empty window, and non-zero minutes", () => {
    for (const statement of [
      "Working hours 9-24",
      "Working hours 24-9",
      "Working hours 18-9",
      "Working hours 9-9",
      "Working hours 9:30-18",
      "Working hours 9-18:15",
      "Working hours 99-100",
    ]) {
      expect(parseWorkingHoursStatement(statement), statement).toBeNull();
    }
  });

  it("reads only `preference` memories, the first match by id order, never by array position", () => {
    const later = m({ id: "b", kind: "preference", statement: "Working hours 10-20" });
    const earlier = m({ id: "a", kind: "preference", statement: "Working hours 9-18" });
    const goal = m({ id: "0", kind: "goal", statement: "Working hours 7-15" });
    const fact = m({ id: "00", kind: "fact", statement: "Working hours 6-14" });
    expect(memoryWorkingHours([later, goal, fact, earlier], ON)).toEqual({
      dayStartHour: 9,
      dayEndHour: 18,
    });
    expect(memoryWorkingHours([goal, fact], ON)).toBeNull();
    expect(memoryWorkingHours([], ON)).toBeNull();
  });

  it("skips a preference that does not parse and keeps looking", () => {
    expect(
      memoryWorkingHours(
        [
          m({ id: "a", kind: "preference", statement: "Working hours 9:45-18" }),
          m({ id: "b", kind: "preference", statement: "Study hours 8-16" }),
        ],
        ON,
      ),
    ).toEqual({ dayStartHour: 8, dayEndHour: 16 });
  });

  it("exposes the grammar as one documented pattern", () => {
    expect(MEMORY_WORKING_HOURS_PATTERN.flags).toBe("i");
    expect(MEMORY_WORKING_HOURS_PATTERN.test("Working hours 9-18")).toBe(true);
    expect(MEMORY_WORKING_HOURS_PATTERN.test("I work 9 to 5")).toBe(false);
  });
});
