// The explicit-moment suggestion sheet (Checkpoint 10.7, ADR-077 §4): the
// store the project screen writes to, and the hookless content the host
// draws. Tree-walk idiom, no render library; the host itself is a React leaf
// (useSyncExternalStore) and is not rendered here.

import type { MemorySuggestion } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_PRIVACY_LINE } from "./memory-privacy";
import {
  MemorySuggestionSheetContent,
  closeMemorySuggestion,
  getMemorySuggestionSheet,
  resetMemorySuggestionSheetForTests,
  showMemorySuggestion,
  subscribeMemorySuggestionSheet,
} from "./memory-suggestion-sheet";

vi.mock("@/queries/memory", () => ({
  useDecideMemorySuggestion: vi.fn(),
}));

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

function findByTestId(node: unknown, testID: string): any {
  return findAll(node, (n) => n.props?.testID === testID)[0];
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

const SUGGESTION: MemorySuggestion = {
  key: "project_goal:22222222-2222-4222-8222-222222222222",
  kind: "project_goal",
  memory_kind: "goal",
  statement: "Finish the thesis draft by December",
  evidence: "From the goal you set on Thesis",
  project: { id: "22222222-2222-4222-8222-222222222222", name: "Thesis" },
};

beforeEach(() => {
  resetMemorySuggestionSheetForTests();
});

describe("the store", () => {
  it("starts closed, opens with a suggestion, closes keeping it for the exit, notifies", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMemorySuggestionSheet(listener);
    expect(getMemorySuggestionSheet()).toEqual({ visible: false, suggestion: null });
    showMemorySuggestion(SUGGESTION);
    expect(getMemorySuggestionSheet()).toEqual({ visible: true, suggestion: SUGGESTION });
    expect(listener).toHaveBeenCalledTimes(1);
    closeMemorySuggestion();
    expect(getMemorySuggestionSheet()).toEqual({ visible: false, suggestion: SUGGESTION });
    expect(listener).toHaveBeenCalledTimes(2);
    closeMemorySuggestion();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    showMemorySuggestion(SUGGESTION);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("<MemorySuggestionSheetContent />", () => {
  function render(overrides: Partial<Parameters<typeof MemorySuggestionSheetContent>[0]> = {}) {
    const onDecide = vi.fn();
    const tree = deepRender(
      MemorySuggestionSheetContent({
        suggestion: SUGGESTION,
        onDecide,
        pending: false,
        error: null,
        ...overrides,
      }),
    );
    return { tree, onDecide };
  }

  it("shows the statement read-only, its evidence and the privacy line", () => {
    const { tree } = render();
    expect(getTextContent(findByTestId(tree, "memory-suggestion-statement"))).toBe(
      SUGGESTION.statement,
    );
    expect(getTextContent(findByTestId(tree, "memory-suggestion-evidence"))).toBe(
      SUGGESTION.evidence,
    );
    expect(getTextContent(tree)).toContain(MEMORY_PRIVACY_LINE);
    // No TextInput: the sentence is accepted as shown or edited afterwards.
    expect(findAll(tree, (n) => n.props?.onChangeText !== undefined)).toEqual([]);
  });

  it("offers exactly Remember / Not now / Never ask again, each wired to its decision", () => {
    const { tree, onDecide } = render();
    const remember = findByTestId(tree, "memory-suggestion-remember");
    const notNow = findByTestId(tree, "memory-suggestion-not-now");
    const never = findByTestId(tree, "memory-suggestion-never");
    expect(getTextContent(remember)).toContain("Remember");
    expect(getTextContent(notNow)).toContain("Not now");
    expect(getTextContent(never)).toContain("Never ask again");
    expect(getTextContent(never)).toContain("for this project's goal");
    remember.props.onPress();
    notNow.props.onPress();
    never.props.onPress();
    expect(onDecide.mock.calls.map((c) => c[0])).toEqual(["remember", "not_now", "never"]);
    // Every row is a labelled button.
    for (const row of [remember, notNow, never]) {
      expect(row.props.accessibilityRole).toBe("button");
      expect(typeof row.props.accessibilityLabel).toBe("string");
    }
  });

  it("disables the rows while a decision is in flight", () => {
    const { tree } = render({ pending: true });
    for (const id of [
      "memory-suggestion-remember",
      "memory-suggestion-not-now",
      "memory-suggestion-never",
    ]) {
      expect(findByTestId(tree, id).props.disabled).toBe(true);
    }
  });

  it("shows a failed decision as an inline alert, never a toast", () => {
    const { tree } = render({ error: "Couldn't save that answer. Try again." });
    const error = findByTestId(tree, "memory-suggestion-error");
    expect(error.props.accessibilityRole).toBe("alert");
    expect(getTextContent(error)).toBe("Couldn't save that answer. Try again.");
  });
});
