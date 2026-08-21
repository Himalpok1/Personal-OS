import { describe, expect, it } from "vitest";
import {
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  canCompleteProject,
  canPauseProject,
  canReopenProject,
  canResumeProject,
  compareNextAction,
  computeProjectProgress,
  isStalledProject,
  lastProjectActivity,
  pickNextAction,
  type PrioritableTask,
  type ProjectStatus,
} from "./project-lifecycle.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-21T12:00:00.000Z");

function task(overrides: Partial<PrioritableTask> = {}): PrioritableTask {
  return { id: "t", dueAt: null, priority: null, createdAt: null, ...overrides };
}

function stalled(
  overrides: Partial<Parameters<typeof isStalledProject>[0]> = {},
): Parameters<typeof isStalledProject>[0] {
  return {
    status: "active",
    openTaskCount: 3,
    lastActivityAt: null,
    nextLinkedEventStart: null,
    effectiveNow: NOW,
    ...overrides,
  };
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (const [i, item] of items.entries()) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      yield [item, ...perm];
    }
  }
}

describe("PROJECT_STATUSES", () => {
  it("is exactly the ADR-039 vocabulary", () => {
    expect([...PROJECT_STATUSES]).toEqual(["active", "paused", "completed"]);
  });
});

describe("canPauseProject", () => {
  it("is true from active", () => {
    expect(canPauseProject("active")).toBe(true);
  });

  it.each(["paused", "completed"] as ProjectStatus[])("is false from %s", (status) => {
    expect(canPauseProject(status)).toBe(false);
  });
});

describe("canResumeProject", () => {
  it("is true from paused", () => {
    expect(canResumeProject("paused")).toBe(true);
  });

  it.each(["active", "completed"] as ProjectStatus[])("is false from %s", (status) => {
    expect(canResumeProject(status)).toBe(false);
  });
});

describe("canCompleteProject", () => {
  it.each(["active", "paused"] as ProjectStatus[])("is true from %s", (status) => {
    expect(canCompleteProject(status)).toBe(true);
  });

  it("is false from completed", () => {
    expect(canCompleteProject("completed")).toBe(false);
  });
});

describe("canReopenProject", () => {
  it("is true from completed", () => {
    expect(canReopenProject("completed")).toBe(true);
  });

  it.each(["active", "paused"] as ProjectStatus[])("is false from %s", (status) => {
    expect(canReopenProject(status)).toBe(false);
  });
});

describe("PROJECT_TRANSITIONS", () => {
  it("maps every status to its exact reachable targets", () => {
    expect(PROJECT_TRANSITIONS).toEqual({
      active: ["paused", "completed"],
      paused: ["active", "completed"],
      completed: ["active"],
    });
  });

  it("only targets vocabulary statuses and agrees with the predicates", () => {
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_TRANSITIONS[from]) {
        expect(PROJECT_STATUSES).toContain(to);
        const allowed =
          (to === "paused" && canPauseProject(from)) ||
          (to === "active" && (canResumeProject(from) || canReopenProject(from))) ||
          (to === "completed" && canCompleteProject(from));
        expect(allowed).toBe(true);
      }
    }
  });
});

describe("archive axis orthogonality", () => {
  // Archiving lives on archived_at (ADR-039 axis separation); the predicates
  // take only a status, so by construction nothing here can consult an
  // archived flag, and out-of-vocabulary values never pass.
  it("rejects the forbidden 'archived' status value on every predicate", () => {
    const archived = "archived" as ProjectStatus;
    expect(canPauseProject(archived)).toBe(false);
    expect(canResumeProject(archived)).toBe(false);
    expect(canCompleteProject(archived)).toBe(false);
    expect(canReopenProject(archived)).toBe(false);
  });

  it("never lists archive-related keys or targets", () => {
    expect(Object.keys(PROJECT_TRANSITIONS).sort()).toEqual(["active", "completed", "paused"]);
    for (const targets of Object.values(PROJECT_TRANSITIONS)) {
      expect(targets).not.toContain("archived");
    }
  });
});

describe("compareNextAction", () => {
  it("orders earlier dueAt first even against better priority", () => {
    const due = task({
      id: "due-low-priority",
      dueAt: new Date(NOW.getTime() + DAY_MS),
      priority: 9,
    });
    const undated = task({ id: "undated-high-priority", priority: 1 });
    expect(compareNextAction(due, undated)).toBeLessThan(0);
  });

  it("sorts null dueAt last", () => {
    const dated = task({ id: "a", dueAt: new Date(NOW.getTime() + 30 * DAY_MS) });
    const undated = task({ id: "b" });
    expect(compareNextAction(dated, undated)).toBeLessThan(0);
    expect(compareNextAction(undated, dated)).toBeGreaterThan(0);
  });

  it("prefers lower priority among equal dues, including negative and large ints", () => {
    const base = new Date("2026-09-01T09:00:00.000Z");
    const pNegative = task({ id: "neg", dueAt: base, priority: -3 });
    const pLarge = task({ id: "big", dueAt: base, priority: 2147483647 });
    const pSmall = task({ id: "small", dueAt: base, priority: 2 });
    expect(compareNextAction(pNegative, pSmall)).toBeLessThan(0);
    expect(compareNextAction(pSmall, pLarge)).toBeLessThan(0);
    expect(compareNextAction(pNegative, pLarge)).toBeLessThan(0);
  });

  it("sorts null priority last at equal dues", () => {
    const base = new Date("2026-09-01T09:00:00.000Z");
    const prioritized = task({ id: "a", dueAt: base, priority: 99 });
    const unprioritized = task({ id: "b", dueAt: base, priority: null });
    expect(compareNextAction(prioritized, unprioritized)).toBeLessThan(0);
  });

  it("breaks equal due+priority by createdAt descending", () => {
    const base = new Date("2026-09-01T09:00:00.000Z");
    const newer = task({
      id: "newer",
      dueAt: base,
      priority: 1,
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    const older = task({
      id: "older",
      dueAt: base,
      priority: 1,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(compareNextAction(newer, older)).toBeLessThan(0);
    expect(compareNextAction(older, newer)).toBeGreaterThan(0);
  });

  it("sorts null createdAt last at equal due+priority", () => {
    const base = new Date("2026-09-01T09:00:00.000Z");
    const created = task({
      id: "a",
      dueAt: base,
      priority: 1,
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const uncreated = task({ id: "b", dueAt: base, priority: 1, createdAt: null });
    expect(compareNextAction(created, uncreated)).toBeLessThan(0);
  });

  it("breaks full ties by lexicographic id ascending", () => {
    const t10 = task({ id: "task10", dueAt: null, priority: null, createdAt: null });
    const t9 = task({ id: "task9", dueAt: null, priority: null, createdAt: null });
    expect(compareNextAction(t10, t9)).toBeLessThan(0);
    expect(compareNextAction(t9, t10)).toBeGreaterThan(0);
  });

  it("returns 0 only for the identical ordering key", () => {
    const a = task({ id: "same" });
    const b = task({ id: "same" });
    expect(compareNextAction(a, b)).toBe(0);
  });

  it("is a stable total order across all 120 permutations of five distinct tasks", () => {
    const canonical: PrioritableTask[] = [
      task({
        id: "t1",
        dueAt: new Date("2026-08-22T00:00:00.000Z"),
        priority: 5,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      task({
        id: "t2",
        dueAt: new Date("2026-08-22T00:00:00.000Z"),
        priority: 5,
        createdAt: new Date("2025-06-01T00:00:00.000Z"),
      }),
      task({
        id: "t3",
        dueAt: new Date("2026-08-22T00:00:00.000Z"),
        priority: null,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      }),
      task({ id: "t4", dueAt: null, priority: 1, createdAt: new Date("2026-02-01T00:00:00.000Z") }),
      task({ id: "t5", dueAt: null, priority: null, createdAt: null }),
    ];
    for (const perm of permutations(canonical)) {
      expect([...perm].sort(compareNextAction)).toEqual(canonical);
    }
  });
});

describe("pickNextAction", () => {
  it("returns null for an empty iterable", () => {
    expect(pickNextAction([])).toBeNull();
  });

  it("returns the single minimum per the frozen comparator", () => {
    const tasks = [
      task({ id: "c", dueAt: new Date("2026-09-05T00:00:00.000Z"), priority: 1 }),
      task({ id: "a", dueAt: new Date("2026-08-23T00:00:00.000Z"), priority: 7 }),
      task({ id: "b", dueAt: new Date("2026-08-25T00:00:00.000Z"), priority: 2 }),
    ];
    expect(pickNextAction(tasks)?.id).toBe("a");
  });

  it("accepts non-array iterables", () => {
    function* gen(): Generator<PrioritableTask> {
      yield task({ id: "x", dueAt: new Date("2026-09-01T00:00:00.000Z") });
      yield task({ id: "y" });
    }
    expect(
      pickNextAction(
        new Set([
          task({ id: "s1" }),
          task({ id: "s2", dueAt: new Date("2026-08-30T00:00:00.000Z") }),
        ]),
      )?.id,
    ).toBe("s2");
    expect(pickNextAction(gen())?.id).toBe("x");
  });

  it("returns the element itself when there is exactly one", () => {
    const only = task({ id: "only" });
    expect(pickNextAction([only])).toBe(only);
  });
});

describe("lastProjectActivity", () => {
  it("returns null when no signal has ever fired", () => {
    expect(
      lastProjectActivity({ taskCompletions: [], noteWrites: [], occurrenceCompletions: [] }),
    ).toBeNull();
  });

  it("returns the max across all three signal kinds", () => {
    const result = lastProjectActivity({
      taskCompletions: [new Date("2026-08-01T00:00:00.000Z")],
      noteWrites: [new Date("2026-08-15T00:00:00.000Z"), new Date("2026-08-10T00:00:00.000Z")],
      occurrenceCompletions: [new Date("2026-08-20T00:00:00.000Z")],
    });
    expect(result).toEqual(new Date("2026-08-20T00:00:00.000Z"));
  });

  it("returns the single signal unchanged", () => {
    const at = new Date("2026-05-05T05:05:05.000Z");
    expect(
      lastProjectActivity({ taskCompletions: [], noteWrites: [at], occurrenceCompletions: [] }),
    ).toEqual(at);
  });
});

describe("isStalledProject", () => {
  it.each(["paused", "completed"] as const)(
    "is false when status is %s regardless of staleness",
    (status) => {
      expect(
        isStalledProject(
          stalled({ status, lastActivityAt: new Date(NOW.getTime() - 400 * DAY_MS) }),
        ),
      ).toBe(false);
    },
  );

  it("is false with zero open tasks", () => {
    expect(isStalledProject(stalled({ openTaskCount: 0 }))).toBe(false);
  });

  it("is false with fresh activity inside the window", () => {
    expect(
      isStalledProject(stalled({ lastActivityAt: new Date(NOW.getTime() - (14 * DAY_MS - 1)) })),
    ).toBe(false);
  });

  it("is true when activity is exactly staleAfterDays old (inclusive boundary)", () => {
    expect(
      isStalledProject(stalled({ lastActivityAt: new Date(NOW.getTime() - 14 * DAY_MS) })),
    ).toBe(true);
  });

  it("is true with no activity signal at all", () => {
    expect(isStalledProject(stalled())).toBe(true);
  });

  it("is false when a linked event starts inside the window", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 40 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() + 3 * DAY_MS),
        }),
      ),
    ).toBe(false);
  });

  it("disqualifies an event starting exactly at effectiveNow (inclusive window start)", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 40 * DAY_MS),
          nextLinkedEventStart: NOW,
        }),
      ),
    ).toBe(false);
  });

  it("does not disqualify an event starting exactly at the window end (exclusive)", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 40 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() + 14 * DAY_MS),
        }),
      ),
    ).toBe(true);
  });

  it("does not disqualify an event beyond the window", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 40 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() + 15 * DAY_MS),
        }),
      ),
    ).toBe(true);
  });

  it("treats a past event as neutral — stale activity still stalls", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 40 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() - 2 * DAY_MS),
        }),
      ),
    ).toBe(true);
  });

  it("honors custom staleAfterDays for both the activity and event windows", () => {
    expect(
      isStalledProject(
        stalled({ lastActivityAt: new Date(NOW.getTime() - 8 * DAY_MS), staleAfterDays: 7 }),
      ),
    ).toBe(true);
    expect(
      isStalledProject(
        stalled({ lastActivityAt: new Date(NOW.getTime() - 6 * DAY_MS), staleAfterDays: 7 }),
      ),
    ).toBe(false);
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 8 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() + 6 * DAY_MS),
          staleAfterDays: 7,
        }),
      ),
    ).toBe(false);
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 8 * DAY_MS),
          nextLinkedEventStart: new Date(NOW.getTime() + 7 * DAY_MS),
          staleAfterDays: 7,
        }),
      ),
    ).toBe(true);
  });

  it("supports fractional staleAfterDays since the math is pure milliseconds", () => {
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000),
          staleAfterDays: 0.5,
        }),
      ),
    ).toBe(true);
    expect(
      isStalledProject(
        stalled({
          lastActivityAt: new Date(NOW.getTime() - 11 * 60 * 60 * 1000),
          staleAfterDays: 0.5,
        }),
      ),
    ).toBe(false);
  });

  it("is unaffected by intervals spanning a DST transition (pure ms math)", () => {
    // 2026-03-08 is the US spring-forward instant; a fixed 14*DAY_MS gap
    // crossing it must behave identically to any other 14-day gap.
    const beforeDST = new Date("2026-03-07T12:00:00.000Z");
    const afterDST = new Date(beforeDST.getTime() + 14 * DAY_MS);
    expect(isStalledProject(stalled({ effectiveNow: afterDST, lastActivityAt: beforeDST }))).toBe(
      true,
    );
  });
});

describe("computeProjectProgress", () => {
  it("passes counts through untouched, mapping openTaskCount to open", () => {
    const lastActivityAt = new Date("2026-08-19T08:00:00.000Z");
    expect(
      computeProjectProgress({
        openTaskCount: 4,
        overdueTaskCount: 2,
        doneTaskCount: 11,
        lastActivityAt,
      }),
    ).toEqual({
      open: 4,
      overdue: 2,
      done: 11,
      lastActivityAt,
    });
  });

  it("preserves a null lastActivityAt and adds nothing derived", () => {
    const progress = computeProjectProgress({
      openTaskCount: 0,
      overdueTaskCount: 0,
      doneTaskCount: 0,
      lastActivityAt: null,
    });
    expect(progress).toEqual({ open: 0, overdue: 0, done: 0, lastActivityAt: null });
    expect(Object.keys(progress).sort()).toEqual(["done", "lastActivityAt", "open", "overdue"]);
  });
});
