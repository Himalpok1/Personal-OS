// Render-level tests for <RecentActivitySection /> (Checkpoint 10.5), same
// hook-mock + tree-walk technique as academic-today-card.test.tsx.

import { Pressable, Text, View } from "react-native";
import { describe, expect, it } from "vitest";
import type { ProjectContextResponse } from "@personal-os/schema";
import { RecentActivitySection } from "./recent-activity-section";

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;
  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    return deepRender((el.type as (props: unknown) => unknown)(el.props ?? {}));
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

type Activity = ProjectContextResponse["recent_activity"];

function activityItem(
  overrides: Partial<Activity["items"][number]> = {},
): Activity["items"][number] {
  return {
    type: "task_completed",
    description: 'Completed "Call the insurance guy"',
    at: "2026-09-15T14:00:00.000Z",
    ...overrides,
  };
}

function render(activity: Activity): unknown {
  return deepRender(RecentActivitySection({ activity }));
}

describe("RecentActivitySection", () => {
  it("renders nothing when there is no recent activity", () => {
    expect(RecentActivitySection({ activity: { items: [], total: 0 } })).toBeNull();
  });

  it("shows the server's description verbatim, never re-derived from type + a title", () => {
    const text = getTextContent(render({ items: [activityItem()], total: 1 }));
    expect(text).toContain("Recent Activity");
    expect(text).toContain('Completed "Call the insurance guy"');
  });

  it("renders every activity type without throwing", () => {
    const items = [
      activityItem({ type: "task_completed", description: "Completed one" }),
      activityItem({ type: "note_written", description: "Wrote a note" }),
      activityItem({ type: "occurrence_completed", description: "Completed an occurrence" }),
    ];
    const text = getTextContent(render({ items, total: 3 }));
    expect(text).toContain("Completed one");
    expect(text).toContain("Wrote a note");
    expect(text).toContain("Completed an occurrence");
  });

  it("rows are inert -- no press handler on any row", () => {
    const tree = render({ items: [activityItem()], total: 1 });
    expect(findAll(tree, (n) => n.type === Pressable)).toEqual([]);
  });

  it("shows an honest '+N more' line only when the total exceeds the rows shown", () => {
    expect(getTextContent(render({ items: [activityItem()], total: 1 }))).not.toContain("more");
    expect(getTextContent(render({ items: [activityItem()], total: 4 }))).toContain("3 more");
  });
});
