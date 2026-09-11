import { Pressable, Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { AskModeToggle } from "./mode-toggle";

// Same hand-rolled render walk every render-style test in this app uses (see
// __tests__/search-screen.test.tsx). AskModeToggle is hookless and
// props-driven, so it can be called directly.

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

/* eslint-disable @typescript-eslint/no-explicit-any */
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

function findByTestId(node: unknown, testID: string): any {
  return findAll(node, (n) => n.props?.testID === testID)[0];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

describe("AskModeToggle", () => {
  it("renders both segments, labelled Search and Ask", () => {
    const tree = deepRender(AskModeToggle({ mode: "search", onChange: vi.fn() }));
    expect(getTextContent(findByTestId(tree, "ask-mode-search"))).toBe("Search");
    expect(getTextContent(findByTestId(tree, "ask-mode-ask"))).toBe("Ask");
  });

  it("marks only the active segment as selected", () => {
    const tree = deepRender(AskModeToggle({ mode: "ask", onChange: vi.fn() }));
    expect(findByTestId(tree, "ask-mode-search").props.accessibilityState).toEqual({
      selected: false,
    });
    expect(findByTestId(tree, "ask-mode-ask").props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it("calls onChange with the tapped segment's value", () => {
    const onChange = vi.fn();
    const tree = deepRender(AskModeToggle({ mode: "search", onChange }));
    findByTestId(tree, "ask-mode-ask").props.onPress();
    expect(onChange).toHaveBeenCalledWith("ask");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
