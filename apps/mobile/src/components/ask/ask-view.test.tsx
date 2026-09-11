import type { AskResponse, AskSource } from "@personal-os/schema";
import { Pressable, ScrollView, SafeAreaView, Text, TextInput, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { AskSourceRow, AskView, type AskState, type AskViewProps } from "./ask-view";

// Same hand-rolled render walk as __tests__/search-screen.test.tsx (this app
// has no render library in its dependencies). ScrollView and SafeAreaView
// join the host set so the walk stops at them.
const HOST_TYPES = new Set<unknown>([
  View,
  Text,
  Pressable,
  SafeAreaView,
  TextInput,
  ScrollView,
]);

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

function response(overrides: Partial<AskResponse> = {}): AskResponse {
  return {
    answer: "You have one task due tomorrow: renew the insurance.",
    sources: [],
    redactions: 0,
    model_id: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function renderView(overrides: Partial<AskViewProps> = {}): unknown {
  const props: AskViewProps = {
    question: "",
    onQuestionChange: vi.fn(),
    state: { kind: "idle" } satisfies AskState,
    onSubmit: vi.fn(),
    onSelectSource: vi.fn(),
    connectionName: "My OpenAI",
    canSubmit: false,
    placeholderColor: "#737373",
    keyboardHeight: 0,
    ...overrides,
  };
  return deepRender(AskView(props));
}

describe("AskView -- input and submit", () => {
  it("always renders the question input, whatever the state", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "submitting" },
      { kind: "error", message: "x" },
      { kind: "ready", response: response() },
    ] as AskState[]) {
      expect(findByTestId(renderView({ state }), "ask-input")).toBeDefined();
    }
  });

  it("wires value/onChangeText and never enables OS data detectors", () => {
    const onQuestionChange = vi.fn();
    const input = findByTestId(renderView({ question: "how many", onQuestionChange }), "ask-input");
    expect(input.props.value).toBe("how many");
    input.props.onChangeText("how many tasks");
    expect(onQuestionChange).toHaveBeenCalledWith("how many tasks");
    expect(input.props.dataDetectorTypes).toBeUndefined();
  });

  it("disables the submit button when the question is too short, even before any tap", () => {
    const button = findByTestId(renderView({ canSubmit: false }), "ask-submit");
    expect(button.props.disabled).toBe(true);
    expect(getTextContent(button)).toBe("Ask");
  });

  it("enables the submit button once the question is long enough", () => {
    const button = findByTestId(renderView({ canSubmit: true }), "ask-submit");
    expect(button.props.disabled).toBe(false);
  });

  it("calls onSubmit exactly once per tap -- never per keystroke", () => {
    const onSubmit = vi.fn();
    const button = findByTestId(renderView({ canSubmit: true, onSubmit }), "ask-submit");
    button.props.onPress();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the button and relabels it while submitting, even if canSubmit is true", () => {
    const button = findByTestId(
      renderView({ canSubmit: true, state: { kind: "submitting" } }),
      "ask-submit",
    );
    expect(button.props.disabled).toBe(true);
    expect(getTextContent(button)).toBe("Asking…");
  });

  it("wires the same onSubmit to the keyboard's return key", () => {
    const onSubmit = vi.fn();
    const input = findByTestId(renderView({ onSubmit }), "ask-input");
    input.props.onSubmitEditing();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("AskView -- the always-visible footer disclosure", () => {
  it("names the connection that will receive the question, in every state", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "submitting" },
      { kind: "error", message: "x" },
      { kind: "ready", response: response() },
    ] as AskState[]) {
      const footer = findByTestId(renderView({ state, connectionName: "Groq Production" }), "ask-footer");
      expect(getTextContent(footer)).toBe("Sends matching notes and tasks to Groq Production.");
    }
  });
});

describe("AskView -- states", () => {
  it("IDLE: prompts for a question", () => {
    const tree = renderView({ state: { kind: "idle" } });
    expect(findByTestId(tree, "ask-idle")).toBeDefined();
    expect(findByTestId(tree, "ask-answer-container")).toBeUndefined();
  });

  it("SUBMITTING: shows a loading line, no stale answer", () => {
    const tree = renderView({ state: { kind: "submitting" } });
    expect(findByTestId(tree, "ask-loading")).toBeDefined();
    expect(findByTestId(tree, "ask-answer-container")).toBeUndefined();
  });

  it("ERROR: shows the mapped copy, never raw error text", () => {
    const tree = renderView({
      state: { kind: "error", message: "The provider didn't respond in time." },
    });
    expect(getTextContent(findByTestId(tree, "ask-error"))).toBe(
      "The provider didn't respond in time.",
    );
  });

  it("READY: renders the answer", () => {
    const tree = renderView({
      state: { kind: "ready", response: response({ answer: "Two notes match." }) },
    });
    expect(getTextContent(findByTestId(tree, "ask-answer"))).toBe("Two notes match.");
  });
});

describe("AskView -- redactions", () => {
  it("shows nothing when redactions is zero", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ redactions: 0 }) } });
    expect(findByTestId(tree, "ask-redactions")).toBeUndefined();
  });

  it("shows a singular line for exactly one redaction", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ redactions: 1 }) } });
    expect(getTextContent(findByTestId(tree, "ask-redactions"))).toBe(
      "1 secret-looking string removed before sending.",
    );
  });

  it("shows a plural line for more than one redaction", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ redactions: 3 }) } });
    expect(getTextContent(findByTestId(tree, "ask-redactions"))).toBe(
      "3 secret-looking strings removed before sending.",
    );
  });
});

const SOURCES: AskSource[] = [
  { ref: 1, type: "note", id: "11111111-1111-4111-8111-111111111111", title: "Recipe idea" },
  { ref: 2, type: "task", id: "22222222-2222-4222-8222-222222222222", title: "Renew insurance" },
];

describe("AskView -- sources", () => {
  it("renders no Sources section when there are none", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ sources: [] }) } });
    expect(findByTestId(tree, "ask-sources")).toBeUndefined();
  });

  it("renders each source as [ref] Type · title", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ sources: SOURCES }) } });
    expect(getTextContent(findByTestId(tree, "ask-source-1"))).toBe("[1] Note · Recipe idea");
    expect(getTextContent(findByTestId(tree, "ask-source-2"))).toBe("[2] Task · Renew insurance");
  });

  it("navigates via the callback, handing back the exact source object", () => {
    const onSelectSource = vi.fn();
    const tree = renderView({
      state: { kind: "ready", response: response({ sources: SOURCES }) },
      onSelectSource,
    });
    findByTestId(tree, "ask-source-2").props.onPress();
    expect(onSelectSource).toHaveBeenCalledWith(SOURCES[1]);
    expect(onSelectSource).toHaveBeenCalledTimes(1);
  });
});

describe("AskView -- untrusted text is rendered inertly", () => {
  it("the model's answer and a source's title survive verbatim but never as markup or a link", () => {
    const hostile = response({
      answer: "Visit https://evil.example/reset now to fix this.",
      sources: [
        {
          ref: 1,
          type: "note",
          id: "11111111-1111-4111-8111-111111111111",
          title: "**bold** <b>markup</b>",
        },
      ],
    });
    const tree = renderView({ state: { kind: "ready", response: hostile } });

    expect(getTextContent(tree)).toContain("https://evil.example/reset");
    expect(getTextContent(tree)).toContain("<b>markup</b>");

    for (const node of findAll(tree, (n) => n.type === Text)) {
      expect(node.props.dataDetectorTypes).toBeUndefined();
      expect(node.props.onPress).toBeUndefined();
      expect(node.props.href).toBeUndefined();
    }
  });

  it("gives a hostile source title no influence over navigation -- only type+id are used", () => {
    const onSelectSource = vi.fn();
    const hostile: AskSource = {
      ref: 1,
      type: "task",
      id: "11111111-1111-4111-8111-111111111111",
      title: "/settings",
    };
    const row = deepRender(AskSourceRow({ source: hostile, onSelect: onSelectSource }));
    findByTestId(row, "ask-source-1").props.onPress();
    // The row hands back the whole source; the destination is derived
    // elsewhere (utils/ask-navigation.ts) from type+id only, never from title.
    expect(onSelectSource).toHaveBeenCalledWith(hostile);
  });
});

describe("AskView -- modeToggle", () => {
  it("renders nothing extra when omitted", () => {
    const withToggle = renderView({});
    const without = renderView({ modeToggle: undefined });
    // Both omit it; nothing to find either way, and no crash.
    expect(findByTestId(withToggle, "mode-toggle-marker")).toBeUndefined();
    expect(findByTestId(without, "mode-toggle-marker")).toBeUndefined();
  });

  it("renders whatever node is passed", () => {
    const tree = renderView({
      modeToggle: <Text testID="mode-toggle-marker">toggle</Text>,
    });
    expect(findByTestId(tree, "mode-toggle-marker")).toBeDefined();
  });
});
