// Render-level tests for <RelatedCapturesSection /> (Checkpoint 10.5), same
// hook-mock + tree-walk technique as academic-today-card.test.tsx: this app
// has no render library, so the hook-free component is called directly and
// the plain element tree it returns is walked.

import { Pressable, Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import type { ProjectContextResponse } from "@personal-os/schema";
import { RelatedCapturesSection } from "./related-captures-section";

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

type Captures = ProjectContextResponse["related_captures"];

function capture(overrides: Partial<Captures["items"][number]> = {}): Captures["items"][number] {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    raw_text: "call mom Sunday",
    source: "web",
    status: "confirmed",
    captured_at: "2026-09-15T14:00:00.000Z",
    entity_type: "task",
    entity_id: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

function render(captures: Captures, onOpenCapture = vi.fn()): unknown {
  return deepRender(RelatedCapturesSection({ captures, onOpenCapture }));
}

describe("RelatedCapturesSection", () => {
  it("renders nothing when there are no captures", () => {
    expect(
      RelatedCapturesSection({ captures: { items: [], total: 0 }, onOpenCapture: vi.fn() }),
    ).toBeNull();
  });

  it("shows the section header with the server's honest total and each capture's raw text", () => {
    const tree = render({ items: [capture()], total: 1 });
    const text = getTextContent(tree);
    expect(text).toContain("Related Captures");
    expect(text).toContain("1");
    expect(text).toContain("call mom Sunday");
  });

  it("navigates to the capture on tap", () => {
    const onOpenCapture = vi.fn();
    const tree = render({ items: [capture()], total: 1 }, onOpenCapture);
    const row = findAll(tree, (n) => n.type === Pressable).find((p) =>
      getTextContent(p).includes("call mom Sunday"),
    );
    expect(row).toBeDefined();
    row.props.onPress();
    expect(onOpenCapture).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to a generic title for a null raw_text, never a blank row", () => {
    const tree = render({ items: [capture({ raw_text: null })], total: 1 });
    expect(getTextContent(tree)).toContain("Untitled capture");
  });

  it("shows an honest '+N more' line only when the total exceeds the rows shown", () => {
    expect(getTextContent(render({ items: [capture()], total: 1 }))).not.toContain("more");
    const capped = getTextContent(render({ items: [capture()], total: 5 }));
    expect(capped).toContain("4 more");
  });
});
