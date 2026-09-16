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
  MAX_ROWS_PER_SECTION,
  shouldRenderAcademicCard,
  visibleAcademicSections,
} from "./academic-today-card-state";
import { SOURCE_BASE_URL, academicToday, assignment } from "./fixtures.test-support";

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
