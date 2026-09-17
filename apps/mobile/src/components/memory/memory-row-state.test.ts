import type { MemoryItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  MEMORY_KIND_ORDER,
  MEMORY_KIND_PRESENTATION,
  formatMemoryDate,
  formatMemoryDateSpoken,
  groupMemoriesByKind,
  isDifferentLocalDay,
  memoryHeroHeadline,
  memoryKindCounts,
  memoryLinkChip,
  memoryRowSpoken,
  memorySourceLine,
  memorySourceWord,
} from "./memory-row-state";

// Local-midday instants, so the device-local day is the same in every zone
// the suite might run in (the formatter reads local getters on purpose).
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  const created = local(2026, 9, 17);
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "preference",
    statement: "I work best in the evening",
    note: null,
    source: "user",
    suggestion_id: null,
    project_id: null,
    canvas_course_id: null,
    created_at: created,
    updated_at: created,
    project: null,
    course: null,
    ...overrides,
  };
}

describe("kind presentation", () => {
  it("orders the sections Preferences, Goals, Facts", () => {
    expect(MEMORY_KIND_ORDER).toEqual(["preference", "goal", "fact"]);
  });

  it("gives each kind its icon, tone and words", () => {
    expect(MEMORY_KIND_PRESENTATION.preference).toEqual({
      label: "Preference",
      plural: "Preferences",
      icon: "heart-outline",
      tone: "primary",
    });
    expect(MEMORY_KIND_PRESENTATION.goal).toEqual({
      label: "Goal",
      plural: "Goals",
      icon: "flag-outline",
      tone: "success",
    });
    expect(MEMORY_KIND_PRESENTATION.fact).toEqual({
      label: "Fact",
      plural: "Facts",
      icon: "information-outline",
      tone: "info",
    });
  });
});

describe("dates", () => {
  it("formats the device-local day as `17 Sep 2026`", () => {
    expect(formatMemoryDate(local(2026, 9, 17))).toBe("17 Sep 2026");
    expect(formatMemoryDate(local(2027, 1, 3))).toBe("3 Jan 2027");
  });

  it("speaks the long month without the year", () => {
    expect(formatMemoryDateSpoken(local(2026, 9, 17))).toBe("17 September");
  });

  it("compares local days, not instants", () => {
    expect(isDifferentLocalDay(local(2026, 9, 17, 9), local(2026, 9, 17, 21))).toBe(false);
    expect(isDifferentLocalDay(local(2026, 9, 17), local(2026, 9, 18))).toBe(true);
  });
});

describe("the source line", () => {
  it("names the provenance", () => {
    expect(memorySourceWord("user")).toBe("Added by you");
    expect(memorySourceWord("suggestion")).toBe("From a suggestion");
  });

  it("reads `Added by you · 17 Sep 2026` for an unedited row", () => {
    expect(memorySourceLine(memory())).toBe("Added by you · 17 Sep 2026");
  });

  it("reads `From a suggestion · …` for an accepted suggestion", () => {
    expect(memorySourceLine(memory({ source: "suggestion" }))).toBe(
      "From a suggestion · 17 Sep 2026",
    );
  });

  it("appends the edit day only when updated_at falls on a later local day", () => {
    expect(memorySourceLine(memory({ updated_at: local(2026, 9, 17, 23) }))).toBe(
      "Added by you · 17 Sep 2026",
    );
    expect(memorySourceLine(memory({ updated_at: local(2026, 9, 18) }))).toBe(
      "Added by you · 17 Sep 2026 · edited 18 Sep",
    );
  });

  it("adds the edit year when it differs from the created year", () => {
    expect(memorySourceLine(memory({ updated_at: local(2027, 1, 2) }))).toBe(
      "Added by you · 17 Sep 2026 · edited 2 Jan 2027",
    );
  });
});

describe("the link chip", () => {
  const project = { id: "22222222-2222-4222-8222-222222222222", name: "Thesis" };
  const course = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Advanced Web Development",
    course_code: "INSY-4315",
  };

  it("is null when nothing is linked", () => {
    expect(memoryLinkChip(memory())).toBeNull();
  });

  it("shows the project name, neutral", () => {
    expect(memoryLinkChip(memory({ project }))).toEqual({ label: "Thesis", tone: "neutral" });
  });

  it("shows the course code (or its name without one) when only a course is linked", () => {
    expect(memoryLinkChip(memory({ course }))).toEqual({ label: "INSY-4315", tone: "neutral" });
    expect(memoryLinkChip(memory({ course: { ...course, course_code: "  " } }))).toEqual({
      label: "Advanced Web Development",
      tone: "neutral",
    });
  });

  it("shows at most one: the project wins over the course", () => {
    expect(memoryLinkChip(memory({ project, course }))).toEqual({
      label: "Thesis",
      tone: "neutral",
    });
  });
});

describe("the spoken row", () => {
  it("speaks kind, statement, provenance and day", () => {
    expect(memoryRowSpoken(memory())).toBe(
      "Preference: I work best in the evening. Added by you 17 September",
    );
  });

  it("adds the link when there is one", () => {
    expect(
      memoryRowSpoken(
        memory({
          kind: "goal",
          statement: "Finish the thesis draft",
          source: "suggestion",
          project: { id: "22222222-2222-4222-8222-222222222222", name: "Thesis" },
        }),
      ),
    ).toBe("Goal: Finish the thesis draft. From a suggestion 17 September. Linked to Thesis");
  });
});

describe("the hero headline", () => {
  it("is singular, plural and honest at zero", () => {
    expect(memoryHeroHeadline(0)).toBe("Personal OS remembers nothing yet");
    expect(memoryHeroHeadline(1)).toBe("Personal OS remembers 1 thing");
    expect(memoryHeroHeadline(3)).toBe("Personal OS remembers 3 things");
  });
});

describe("grouping", () => {
  const items = [
    memory({ id: "a", kind: "fact" }),
    memory({ id: "b", kind: "preference" }),
    memory({ id: "c", kind: "preference" }),
  ];

  it("partitions by kind in display order, keeping the server's order within a kind", () => {
    const groups = groupMemoriesByKind(items);
    expect(groups.map((g) => g.kind)).toEqual(["preference", "goal", "fact"]);
    expect(groups[0]!.items.map((m) => m.id)).toEqual(["b", "c"]);
    expect(groups[1]!.items).toEqual([]);
    expect(groups[2]!.items.map((m) => m.id)).toEqual(["a"]);
  });

  it("counts per kind in the same order", () => {
    expect(memoryKindCounts(items)).toEqual([
      { kind: "preference", count: 2 },
      { kind: "goal", count: 0 },
      { kind: "fact", count: 1 },
    ]);
  });
});
