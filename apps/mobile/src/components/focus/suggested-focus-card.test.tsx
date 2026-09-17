import type { FocusSource, FocusSuggestionResponse } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import {
  SUGGESTED_FOCUS_NOT_ENOUGH_COPY,
  SuggestedFocusCard,
  type SuggestedFocusCardProps,
  type SuggestedFocusState,
} from "./suggested-focus-card";

// Same hand-rolled render walk as ask-view.test.tsx (this app has no render
// library in its dependencies).
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

const SOURCE: FocusSource = {
  ref: 1,
  type: "task",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Electric bill",
  section: "overdue",
  detail: "P1",
};

function suggestionResponse(overrides: Partial<FocusSuggestionResponse> = {}): FocusSuggestionResponse {
  return {
    suggestion: "Consider the electric bill first -- it's overdue and marked P1 [1].",
    source: SOURCE,
    candidate_count: 2,
    model_id: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

function renderCard(overrides: Partial<SuggestedFocusCardProps> = {}): unknown {
  const props: SuggestedFocusCardProps = {
    candidateCount: 2,
    state: { kind: "idle" } satisfies SuggestedFocusState,
    onSuggest: vi.fn(),
    onSelectSource: vi.fn(),
    ...overrides,
  };
  return deepRender(SuggestedFocusCard(props));
}

describe("SuggestedFocusCard -- the candidate-count gate", () => {
  it("renders nothing at all when there are fewer than FOCUS_MIN_CANDIDATES", () => {
    expect(renderCard({ candidateCount: 0 })).toBeNull();
    expect(renderCard({ candidateCount: 1 })).toBeNull();
  });

  it("renders the card at exactly the threshold and above", () => {
    expect(findByTestId(renderCard({ candidateCount: 2 }), "suggested-focus-card")).toBeDefined();
    expect(findByTestId(renderCard({ candidateCount: 5 }), "suggested-focus-card")).toBeDefined();
  });

  it("never calls onSuggest on its own -- mounting/rendering is not a tap", () => {
    const onSuggest = vi.fn();
    renderCard({ onSuggest });
    expect(onSuggest).not.toHaveBeenCalled();
  });
});

describe("SuggestedFocusCard -- idle and loading", () => {
  it("idle shows a 'Suggest focus' button, enabled", () => {
    const tree = renderCard({ state: { kind: "idle" } });
    const button = findByTestId(tree, "suggested-focus-suggest");
    expect(getTextContent(button)).toBe("Suggest focus");
    expect(button.props.disabled).toBeFalsy();
  });

  it("loading shows a disabled 'Thinking…' button", () => {
    const tree = renderCard({ state: { kind: "loading" } });
    const button = findByTestId(tree, "suggested-focus-suggest");
    expect(getTextContent(button)).toBe("Thinking…");
    expect(button.props.disabled).toBe(true);
  });

  it("tapping the idle button calls onSuggest exactly once", () => {
    const onSuggest = vi.fn();
    const tree = renderCard({ state: { kind: "idle" }, onSuggest });
    findByTestId(tree, "suggested-focus-suggest").props.onPress();
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestedFocusCard -- ready", () => {
  it("renders the suggestion text and a single source row", () => {
    const response = suggestionResponse();
    const tree = renderCard({ state: { kind: "ready", response } });
    expect(getTextContent(findByTestId(tree, "suggested-focus-answer"))).toBe(response.suggestion);
    expect(findByTestId(tree, "ask-source-1")).toBeDefined();
  });

  it("tapping the source row hands back the exact FocusSource from the response", () => {
    const onSelectSource = vi.fn();
    const response = suggestionResponse();
    const tree = renderCard({ state: { kind: "ready", response }, onSelectSource });
    findByTestId(tree, "ask-source-1").props.onPress();
    expect(onSelectSource).toHaveBeenCalledWith(response.source);
  });

  it("'Suggest again' calls onSuggest, the same explicit-tap contract as the idle button", () => {
    const onSuggest = vi.fn();
    const tree = renderCard({ state: { kind: "ready", response: suggestionResponse() }, onSuggest });
    findByTestId(tree, "suggested-focus-suggest").props.onPress();
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestedFocusCard -- not_enough_candidates and error", () => {
  it("shows the fixed, non-alarming copy for a server-side race with the client gate", () => {
    const tree = renderCard({ state: { kind: "not_enough_candidates" } });
    expect(getTextContent(findByTestId(tree, "suggested-focus-not-enough"))).toBe(
      SUGGESTED_FOCUS_NOT_ENOUGH_COPY,
    );
  });

  it("not_enough_candidates is never a dead end -- 'Check again' calls onSuggest (9.8 review)", () => {
    const onSuggest = vi.fn();
    const tree = renderCard({ state: { kind: "not_enough_candidates" }, onSuggest });
    const button = findByTestId(tree, "suggested-focus-suggest");
    expect(getTextContent(button)).toBe("Check again");
    button.props.onPress();
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });

  it("shows the error message and a 'Try again' button that calls onSuggest", () => {
    const onSuggest = vi.fn();
    const tree = renderCard({ state: { kind: "error", message: "Couldn't get a suggestion." }, onSuggest });
    expect(getTextContent(findByTestId(tree, "suggested-focus-error"))).toBe(
      "Couldn't get a suggestion.",
    );
    findByTestId(tree, "suggested-focus-suggest").props.onPress();
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});

describe("SuggestedFocusCard -- untrusted text is rendered inertly", () => {
  it("the model's suggestion survives verbatim but never as markup or a link", () => {
    const response = suggestionResponse({
      suggestion: "Visit https://evil.example/reset now to fix this [1].",
    });
    const tree = renderCard({ state: { kind: "ready", response } });

    expect(getTextContent(tree)).toContain("https://evil.example/reset");

    for (const node of findAll(tree, (n) => n.type === Text)) {
      expect(node.props.dataDetectorTypes).toBeUndefined();
      expect(node.props.onPress).toBeUndefined();
      expect(node.props.href).toBeUndefined();
    }
  });
});
