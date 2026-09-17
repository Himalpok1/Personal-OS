// Render-level tests for <AcademicTodayCard /> (Checkpoint 10.2).
//
// Copies mail/digest-today-card.test.tsx's technique exactly, for the reason
// recorded there: this app has no render library, so the component is called
// directly and the plain React element tree it returns is walked. That only
// works because the one hook the card calls (`useAcademicToday`) is mocked
// below, and `useRouter` resolves to src/__mocks__/expo-router.ts, whose
// implementation is a plain function with no dispatcher underneath.
//
// What these pin:
//   1. the card's whole posture -- NOTHING while loading, on error, when
//      unconfigured, and when there is nothing to show;
//   2. honest totals in every header and a "+N more" line whenever the total
//      exceeds the rows rendered, with rows capped per section;
//   3. the badge rule (Missing beats Late; neither for a plain open row);
//   4. the same-origin gate Checkpoint 10.1 verified live: a matching origin
//      renders a `link` with a handler, a mismatched one renders no role and
//      no handler, and `html_url` is never rendered as text either way.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAcademicToday } from "@/queries/academic";
import { AcademicTodayCard } from "./academic-today-card";
import {
  MAX_PRIORITY_ROWS,
  MAX_ROWS_PER_SECTION,
  shouldRenderAcademicCard,
  visibleAcademicSections,
  visiblePriorities,
} from "./academic-today-card-state";
import {
  SOURCE_BASE_URL,
  academicToday,
  assignment,
  courseAttention,
  priorityItem,
  workload,
} from "./fixtures.test-support";

vi.mock("@/queries/academic", () => ({ useAcademicToday: vi.fn() }));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;

  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    const rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    return deepRender(rendered);
  }

  if (el.props && "children" in el.props) {
    return { ...el, props: { ...el.props, children: deepRender(el.props.children) } };
  }
  return el;
}

function findAll(node: unknown, predicate: (n: any) => boolean, acc: any[] = []): any[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) {
    const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
    for (const child of children) findAll(child, predicate, acc);
  }
  return acc;
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

function findPressables(node: unknown): any[] {
  return findAll(node, (n) => n.type === Pressable);
}

/** The row Pressables only -- every Pressable except the "Courses ›" header affordance. */
function findRows(node: unknown): any[] {
  return findPressables(node).filter((p) => p.props.accessibilityLabel !== "View courses");
}

function render(): unknown {
  return deepRender(AcademicTodayCard());
}

function mockQuery(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAcademicToday).mockReturnValue({
    isLoading: false,
    isError: false,
    data: academicToday(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery();
});

describe("renders nothing", () => {
  it("while loading", () => {
    mockQuery({ isLoading: true, data: undefined });
    expect(AcademicTodayCard()).toBeNull();
  });

  it("on an error -- Today is not the place to explain a Canvas outage", () => {
    mockQuery({ isError: true, data: undefined });
    expect(AcademicTodayCard()).toBeNull();
  });

  it("when the server has no active academic connection", () => {
    mockQuery({
      data: academicToday({
        configured: false,
        // Even with a stray non-zero count, unconfigured means nothing.
        summary: { ...academicToday().summary, unread_announcements_total: 2 },
      }),
    });
    expect(AcademicTodayCard()).toBeNull();
  });

  it("when every section it would show is empty", () => {
    expect(AcademicTodayCard()).toBeNull();
  });

  it("even when only events (which the card never renders) are non-empty", () => {
    mockQuery({
      data: academicToday({
        events: {
          items: [],
          total: 2,
        },
      }),
    });
    expect(AcademicTodayCard()).toBeNull();
  });
});

describe("sections", () => {
  it("renders the three sections in order, each with the server's honest total", () => {
    mockQuery({
      data: academicToday({
        overdue: { items: [assignment({ id: "o1", title: "Overdue one" })], total: 1 },
        due_today: { items: [assignment({ id: "t1", title: "Today one" })], total: 1 },
        due_this_week: { items: [assignment({ id: "w1", title: "Week one" })], total: 1 },
      }),
    });
    const text = getTextContent(render());
    expect(text).toContain("Academics");
    expect(text).toContain("Courses ›");
    const overdueAt = text.indexOf("Overdue · 1");
    const todayAt = text.indexOf("Due today · 1");
    const weekAt = text.indexOf("Due this week · 1");
    expect(overdueAt).toBeGreaterThan(-1);
    expect(todayAt).toBeGreaterThan(overdueAt);
    expect(weekAt).toBeGreaterThan(todayAt);
    expect(text).toContain("Overdue one");
    expect(text).toContain("Today one");
    expect(text).toContain("Week one");
  });

  it("omits an empty section rather than rendering an empty header", () => {
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment({ id: "t1" })], total: 1 },
      }),
    });
    const text = getTextContent(render());
    expect(text).toContain("Due today · 1");
    expect(text).not.toContain("Overdue");
    expect(text).not.toContain("Due this week");
  });

  it("caps rows per section and says how many more the total holds", () => {
    const items = [1, 2, 3, 4, 5].map((n) => assignment({ id: `w${n}`, title: `Week ${n}` }));
    mockQuery({ data: academicToday({ due_this_week: { items, total: 7 } }) });
    const tree = render();
    const text = getTextContent(tree);
    expect(text).toContain("Due this week · 7");
    expect(findRows(tree)).toHaveLength(MAX_ROWS_PER_SECTION);
    expect(text).toContain("Week 1");
    expect(text).toContain(`Week ${MAX_ROWS_PER_SECTION}`);
    expect(text).not.toContain(`Week ${MAX_ROWS_PER_SECTION + 1}`);
    // 7 total, 3 shown.
    expect(text).toContain("+4 more");
  });

  it("shows no '+N more' when every item is rendered", () => {
    mockQuery({
      data: academicToday({
        overdue: { items: [assignment({ id: "o1" }), assignment({ id: "o2" })], total: 2 },
      }),
    });
    expect(getTextContent(render())).not.toContain("more");
  });

  it("renders the course label and due label on each row", () => {
    mockQuery({
      data: academicToday({
        overdue: {
          items: [
            assignment({ course_code: "INSY 4315", course_name: "Advanced Web Development" }),
          ],
          total: 1,
        },
      }),
    });
    const text = getTextContent(render());
    expect(text).toContain("INSY 4315");
    // The code stands in for the full name on a 480px row.
    expect(text).not.toContain("Advanced Web Development");
    // The due label carries a month and a time separator; the exact words
    // depend on the device locale and are pinned in format.test.ts.
    expect(text).toMatch(/Sep 2[23] · /);
  });

  it("falls back to the course name when there is no code", () => {
    mockQuery({
      data: academicToday({
        overdue: { items: [assignment({ course_code: null })], total: 1 },
      }),
    });
    expect(getTextContent(render())).toContain("Advanced Web Development");
  });
});

describe("badges", () => {
  it("shows Missing for a missing submission", () => {
    mockQuery({
      data: academicToday({
        overdue: {
          items: [
            assignment({
              submission: { status: "unsubmitted", missing: true, late: false, submitted_at: null },
            }),
          ],
          total: 1,
        },
      }),
    });
    const text = getTextContent(render());
    expect(text).toContain("Missing");
    expect(text).not.toContain("Late");
  });

  it("shows Late for a late submission, and Missing wins when both are set", () => {
    mockQuery({
      data: academicToday({
        due_today: {
          items: [
            assignment({
              id: "late",
              submission: { status: "unsubmitted", missing: false, late: true, submitted_at: null },
            }),
            assignment({
              id: "both",
              submission: { status: "unsubmitted", missing: true, late: true, submitted_at: null },
            }),
          ],
          total: 2,
        },
      }),
    });
    const rows = findRows(render());
    expect(getTextContent(rows[0])).toContain("Late");
    expect(getTextContent(rows[0])).not.toContain("Missing");
    expect(getTextContent(rows[1])).toContain("Missing");
    expect(getTextContent(rows[1])).not.toContain("Late");
  });

  it("shows no badge for a plain open assignment", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    const text = getTextContent(render());
    expect(text).not.toContain("Missing");
    expect(text).not.toContain("Late");
    expect(text).not.toContain("Submitted");
  });
});

describe("unread announcements footer", () => {
  it("appears only when the unread total is positive, pluralized honestly", () => {
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment()], total: 1 },
        summary: { ...academicToday().summary, unread_announcements_total: 1 },
      }),
    });
    expect(getTextContent(render())).toContain("1 unread announcement");

    mockQuery({
      data: academicToday({
        summary: { ...academicToday().summary, unread_announcements_total: 3 },
      }),
    });
    expect(getTextContent(render())).toContain("3 unread announcements");
  });

  it("is enough on its own to render the card", () => {
    mockQuery({
      data: academicToday({
        summary: { ...academicToday().summary, unread_announcements_total: 2 },
      }),
    });
    const tree = render();
    expect(tree).not.toBeNull();
    expect(getTextContent(tree)).toContain("Academics");
    expect(findRows(tree)).toHaveLength(0);
  });

  it("is absent at zero", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    expect(getTextContent(render())).not.toContain("unread");
  });
});

describe("same-origin gating (Checkpoint 10.1's live-verified rule, preserved)", () => {
  it("renders a row on the connection's own origin as a link with a handler", () => {
    mockQuery({
      data: academicToday({
        overdue: {
          items: [assignment({ html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001` })],
          total: 1,
        },
      }),
    });
    const [row] = findRows(render());
    expect(row.props.accessibilityRole).toBe("link");
    expect(row.props.disabled).toBe(false);
    expect(typeof row.props.onPress).toBe("function");
  });

  it("renders a row on any other origin as inert text: no role, no handler", () => {
    mockQuery({
      data: academicToday({
        overdue: {
          items: [assignment({ html_url: "https://evil.example.com/courses/1/assignments/1001" })],
          total: 1,
        },
      }),
    });
    const [row] = findRows(render());
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.disabled).toBe(true);
    expect(row.props.onPress).toBeUndefined();
  });

  it("renders a row with no html_url as inert too", () => {
    mockQuery({
      data: academicToday({ overdue: { items: [assignment({ html_url: null })], total: 1 } }),
    });
    const [row] = findRows(render());
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();
  });

  it("never renders html_url as text, openable or not", () => {
    mockQuery({
      data: academicToday({
        overdue: {
          items: [
            assignment({ id: "ok", html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001` }),
            assignment({ id: "bad", html_url: "https://evil.example.com/x" }),
          ],
          total: 2,
        },
      }),
    });
    const text = getTextContent(render());
    expect(text).not.toContain("instructure.com");
    expect(text).not.toContain("evil.example.com");
    expect(text).not.toContain("http");
  });
});

describe("the Courses affordance", () => {
  it("is a 44px-minimum button labelled for assistive tech", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    const header = findPressables(render()).find(
      (p) => p.props.accessibilityLabel === "View courses",
    );
    expect(header).toBeDefined();
    expect(header.props.accessibilityRole).toBe("button");
    expect(header.props.className).toContain("min-h-[44px]");
    expect(typeof header.props.onPress).toBe("function");
  });
});

describe("the 'Focus on' course chips (Checkpoint 10.5)", () => {
  it("each chip is a labelled, navigable button, not an inert StatusChip", () => {
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment()], total: 1 },
        course_attention: {
          items: [courseAttention({ course_id: "course-a", course_code: "INSY 4315" })],
          total: 1,
        },
      }),
    });
    const chip = findPressables(render()).find(
      (p) => p.props.accessibilityLabel === "Open course: INSY 4315",
    );
    expect(chip).toBeDefined();
    expect(chip.props.accessibilityRole).toBe("button");
    expect(typeof chip.props.onPress).toBe("function");
    // Never throws against the mocked router -- it just proves this is a
    // real navigation call site, not a decorative StatusChip.
    expect(() => chip.props.onPress()).not.toThrow();
  });

  it("still renders the course label as its own StatusChip inside the Pressable", () => {
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment()], total: 1 },
        course_attention: {
          items: [courseAttention({ course_id: "course-a", course_code: "INSY 4315" })],
          total: 1,
        },
      }),
    });
    expect(getTextContent(render())).toContain("INSY 4315");
  });
});

describe("state helpers", () => {
  it("shouldRenderAcademicCard is false when unconfigured whatever the counts", () => {
    expect(
      shouldRenderAcademicCard(
        academicToday({
          configured: false,
          overdue: { items: [assignment()], total: 1 },
        }),
      ),
    ).toBe(false);
  });

  it("visibleAcademicSections shows a section whose total is positive even if items came back empty", () => {
    // A contract regression in either direction shows rather than hides.
    const [section] = visibleAcademicSections(academicToday({ overdue: { items: [], total: 4 } }));
    expect(section).toMatchObject({ key: "overdue", total: 4, rows: [], hiddenCount: 4 });
  });

  it("visibleAcademicSections never recomputes the total from the capped rows", () => {
    const items = [1, 2, 3, 4].map((n) => assignment({ id: `a${n}` }));
    const [section] = visibleAcademicSections(academicToday({ due_today: { items, total: 9 } }));
    expect(section!.rows).toHaveLength(MAX_ROWS_PER_SECTION);
    expect(section!.total).toBe(9);
    expect(section!.hiddenCount).toBe(9 - MAX_ROWS_PER_SECTION);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 10.3: the intelligence keys (all OPTIONAL on the wire)
// ---------------------------------------------------------------------------

describe("the current term line", () => {
  it("names the term under the header when the server echoes one", () => {
    mockQuery({
      data: academicToday({
        current_term: { name: "2026 Fall", starts_at: "2026-08-24T05:00:00Z" },
        due_today: { items: [assignment()], total: 1 },
      }),
    });
    expect(getTextContent(render())).toContain("2026 Fall");
  });

  it("says nothing about the term when the key is absent or null", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    expect(getTextContent(render())).not.toContain("Fall");
    mockQuery({
      data: academicToday({ current_term: null, due_today: { items: [assignment()], total: 1 } }),
    });
    expect(getTextContent(render())).not.toContain("Fall");
  });
});

describe("the workload status line", () => {
  it("renders Behind with the counts behind it, and is enough on its own to show the card", () => {
    mockQuery({
      data: academicToday({
        workload: workload({ status: "behind", overdue_total: 2, missing_total: 1 }),
      }),
    });
    const tree = render();
    expect(tree).not.toBeNull();
    const text = getTextContent(tree);
    expect(text).toContain("Behind");
    expect(text).toContain("2 overdue · 1 missing");
    expect(findRows(tree)).toHaveLength(0);
  });

  it("renders At risk with the 24h count, and is enough on its own", () => {
    mockQuery({
      data: academicToday({ workload: workload({ status: "at_risk", due_within_24h_total: 1 }) }),
    });
    const text = getTextContent(render());
    expect(text).toContain("At risk");
    expect(text).toContain("1 due in 24h");
  });

  it("an on_track workload alone is NOT enough to render the card", () => {
    mockQuery({ data: academicToday({ workload: workload({ status: "on_track" }) }) });
    expect(AcademicTodayCard()).toBeNull();
  });

  it("renders On track alongside a section when there is one", () => {
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment()], total: 1 },
        workload: workload({ status: "on_track", due_this_week_total: 3 }),
      }),
    });
    const text = getTextContent(render());
    expect(text).toContain("On track");
    expect(text).toContain("3 due this week");
  });
});

describe("the Do next block", () => {
  it("renders the top ranked candidates in server order with an urgency chip each", () => {
    const items = [
      priorityItem({
        assignment: assignment({ id: "p1", title: "Priority one" }),
        urgency: "critical",
        score: 450,
        reasons: ["overdue", "marked_missing"],
        hours_until_due: -3,
      }),
      priorityItem({
        assignment: assignment({ id: "p2", title: "Priority two" }),
        urgency: "high",
      }),
      priorityItem({
        assignment: assignment({ id: "p3", title: "Priority three" }),
        urgency: "medium",
        score: 200,
        reasons: ["due_this_week"],
      }),
    ];
    mockQuery({ data: academicToday({ priorities: { items, total: 3 } }) });
    const tree = render();
    const text = getTextContent(tree);
    expect(text).toContain("Do next");
    const one = text.indexOf("Priority one");
    const two = text.indexOf("Priority two");
    const three = text.indexOf("Priority three");
    expect(one).toBeGreaterThan(-1);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    const rows = findRows(tree);
    expect(rows).toHaveLength(3);
    expect(getTextContent(rows[0])).toContain("Overdue");
    expect(getTextContent(rows[1])).toContain("Due <24h");
    expect(getTextContent(rows[2])).toContain("This week");
    expect(text).not.toContain("more");
  });

  it("caps the rows and says how many more the total holds", () => {
    const items = [1, 2, 3, 4, 5].map((n) =>
      priorityItem({ assignment: assignment({ id: `p${n}`, title: `Priority ${n}` }) }),
    );
    mockQuery({ data: academicToday({ priorities: { items, total: 6 } }) });
    const tree = render();
    expect(findRows(tree)).toHaveLength(MAX_PRIORITY_ROWS);
    expect(getTextContent(tree)).toContain(`+${6 - MAX_PRIORITY_ROWS} more`);
  });

  it("is enough on its own to render the card, and sits before the sections", () => {
    mockQuery({
      data: academicToday({
        priorities: {
          items: [priorityItem({ assignment: assignment({ id: "p1", title: "Priority one" }) })],
          total: 1,
        },
        due_this_week: { items: [assignment({ id: "w1", title: "Week one" })], total: 1 },
      }),
    });
    const text = getTextContent(render());
    expect(text.indexOf("Do next")).toBeLessThan(text.indexOf("Due this week · 1"));
    expect(text.indexOf("Priority one")).toBeLessThan(text.indexOf("Week one"));
  });

  it("renders a priority row through the same same-origin gate as every other row", () => {
    mockQuery({
      data: academicToday({
        priorities: {
          items: [
            priorityItem({
              assignment: assignment({
                id: "ok",
                html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1`,
              }),
            }),
            priorityItem({
              assignment: assignment({ id: "bad", html_url: "https://evil.example.com/x" }),
            }),
          ],
          total: 2,
        },
      }),
    });
    const [ok, bad] = findRows(render());
    expect(ok.props.accessibilityRole).toBe("link");
    expect(typeof ok.props.onPress).toBe("function");
    expect(bad.props.accessibilityRole).toBeUndefined();
    expect(bad.props.onPress).toBeUndefined();
  });

  it("is absent when the key is absent or empty", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    expect(getTextContent(render())).not.toContain("Do next");
    mockQuery({
      data: academicToday({
        priorities: { items: [], total: 0 },
        due_today: { items: [assignment()], total: 1 },
      }),
    });
    expect(getTextContent(render())).not.toContain("Do next");
  });
});

describe("the workload strip", () => {
  it("draws one column per day, labelled for assistive tech, when a workload is present", () => {
    const days = workload().days.map((day, index) => ({ ...day, due_total: index === 2 ? 4 : 0 }));
    mockQuery({
      data: academicToday({
        due_today: { items: [assignment()], total: 1 },
        workload: workload({ days }),
      }),
    });
    const tree = render();
    const strip = findAll(
      tree,
      (n) =>
        typeof n.props?.accessibilityLabel === "string" &&
        n.props.accessibilityLabel.startsWith("This week:"),
    )[0];
    expect(strip).toBeDefined();
    expect(strip.props.accessibilityLabel).toContain("4 due");
    // Eight bars: the styled Views carrying a height.
    const bars = findAll(
      strip,
      (n) => n.type === View && typeof n.props?.style?.height === "number",
    );
    expect(bars).toHaveLength(8);
    expect(Math.max(...bars.map((b) => b.props.style.height))).toBeGreaterThan(
      Math.min(...bars.map((b) => b.props.style.height)),
    );
  });

  it("is absent when the workload key is absent", () => {
    mockQuery({ data: academicToday({ due_today: { items: [assignment()], total: 1 } }) });
    expect(getTextContent(render())).not.toContain("This week");
  });
});

describe("state helpers (10.3)", () => {
  it("visiblePriorities is null for an absent or empty key and capped otherwise", () => {
    expect(visiblePriorities(academicToday())).toBeNull();
    expect(visiblePriorities(academicToday({ priorities: { items: [], total: 0 } }))).toBeNull();
    const items = [1, 2, 3, 4].map((n) =>
      priorityItem({ assignment: assignment({ id: `p${n}` }) }),
    );
    expect(visiblePriorities(academicToday({ priorities: { items, total: 9 } }))).toMatchObject({
      total: 9,
      hiddenCount: 9 - MAX_PRIORITY_ROWS,
    });
  });

  it("visibleAcademicSections skips rows already listed under Do next, keeps the honest total, and drops a section shown in full above", () => {
    const a = assignment({ id: "a" });
    const b = assignment({ id: "b" });
    const c = assignment({ id: "c" });
    const data = academicToday({
      overdue: { items: [a, b], total: 2 },
      due_today: { items: [c], total: 1 },
      due_this_week: { items: [], total: 0 },
    });
    // Nothing shown above: the sections are exactly as before.
    expect(visibleAcademicSections(data).map((s) => [s.key, s.rows.length, s.hiddenCount])).toEqual(
      [
        ["overdue", 2, 0],
        ["due_today", 1, 0],
      ],
    );
    // "Do next" already lists a and c: overdue keeps b only (total still 2,
    // nothing hidden), due_today disappears rather than render a bare header.
    const shown = new Set(["a", "c"]);
    expect(
      visibleAcademicSections(data, shown).map((s) => [
        s.key,
        s.total,
        s.rows.map((r) => r.id),
        s.hiddenCount,
      ]),
    ).toEqual([["overdue", 2, ["b"], 0]]);
    // A capped section counts only rows on neither list as hidden.
    const many = academicToday({
      overdue: { items: [a, b, c, assignment({ id: "d" }), assignment({ id: "e" })], total: 7 },
    });
    expect(visibleAcademicSections(many, new Set(["a"]))[0]).toMatchObject({
      rows: [b, c, assignment({ id: "d" })],
      hiddenCount: 7 - 1 - 3,
    });
  });

  it("the card renders an assignment once: Do next wins, the bucket row is skipped", () => {
    const only = assignment({ id: "only-one", title: "Only once" });
    mockQuery({
      data: academicToday({
        overdue: { items: [only], total: 1 },
        priorities: { items: [priorityItem({ assignment: only, urgency: "critical" })], total: 1 },
      }),
    });
    const tree = render();
    const rows = findRows(tree).filter((p) =>
      String(p.props.accessibilityLabel).startsWith("Only once"),
    );
    expect(rows).toHaveLength(1);
  });

  it("shouldRenderAcademicCard honours the new keys without touching the old rules", () => {
    expect(
      shouldRenderAcademicCard(academicToday({ workload: workload({ status: "behind" }) })),
    ).toBe(true);
    expect(
      shouldRenderAcademicCard(academicToday({ workload: workload({ status: "on_track" }) })),
    ).toBe(false);
    expect(
      shouldRenderAcademicCard(
        academicToday({ configured: false, workload: workload({ status: "behind" }) }),
      ),
    ).toBe(false);
    expect(
      shouldRenderAcademicCard(
        academicToday({ priorities: { items: [priorityItem()], total: 1 } }),
      ),
    ).toBe(true);
  });
});
