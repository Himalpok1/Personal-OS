import type { AskResponse, AskSource } from "@personal-os/schema";
import { Pressable, ScrollView, SafeAreaView, Text, TextInput, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { ASK_PRESETS } from "./ask-presets";
import {
  ASK_NO_CITATIONS_COPY,
  ASK_NOTHING_TODAY_COPY,
  ASK_NOTHING_UPCOMING_COPY,
  AskSourceRow,
  AskView,
  askNothingCopyFor,
  askSourceHeaderText,
  askSourceRowText,
  type AskState,
  type AskViewProps,
} from "./ask-view";

// Same hand-rolled render walk as __tests__/search-screen.test.tsx (this app
// has no render library in its dependencies). ScrollView and SafeAreaView
// join the host set so the walk stops at them.
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, SafeAreaView, TextInput, ScrollView]);

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
    onSelectPreset: vi.fn(),
    selectedPreset: null,
    autoFocus: true,
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
      const footer = findByTestId(
        renderView({ state, connectionName: "Groq Production" }),
        "ask-footer",
      );
      expect(getTextContent(footer)).toBe(
        "Sends your question, today's schedule and matching notes/tasks to Groq Production",
      );
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

const ID = "11111111-1111-4111-8111-111111111111";

const SOURCES: AskSource[] = [
  { ref: 1, type: "note", id: "11111111-1111-4111-8111-111111111111", title: "Recipe idea" },
  { ref: 2, type: "task", id: "22222222-2222-4222-8222-222222222222", title: "Renew insurance" },
];

describe("AskView -- sources", () => {
  it("renders no Sources section when there are none", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ sources: [] }) } });
    expect(findByTestId(tree, "ask-sources")).toBeUndefined();
  });

  it("renders each 8.6B-shaped source (no section) as [ref] Type · title", () => {
    const tree = renderView({ state: { kind: "ready", response: response({ sources: SOURCES }) } });
    expect(getTextContent(findByTestId(tree, "ask-source-1-header"))).toBe("[1] Note");
    expect(getTextContent(findByTestId(tree, "ask-source-1-title"))).toBe("Recipe idea");
    expect(getTextContent(findByTestId(tree, "ask-source-2-header"))).toBe("[2] Task");
    expect(getTextContent(findByTestId(tree, "ask-source-2-title"))).toBe("Renew insurance");
    // The one-string form is still exported for callers that need it.
    expect(askSourceRowText(SOURCES[0]!)).toBe("[1] Note · Recipe idea");
  });

  it("puts the header and the TITLE on separate lines, so 480px never cuts the title", () => {
    const sources: AskSource[] = [
      {
        ref: 1,
        type: "task",
        id: ID,
        title: "Renew the homeowners insurance policy before the deductible changes",
        section: "overdue",
        detail: "P1",
      },
    ];
    const tree = renderView({ state: { kind: "ready", response: response({ sources }) } });

    const header = findByTestId(tree, "ask-source-1-header");
    const title = findByTestId(tree, "ask-source-1-title");
    expect(getTextContent(header)).toBe("[1] Overdue · P1");
    expect(header.props.numberOfLines).toBe(1);
    expect(getTextContent(title)).toBe(sources[0]!.title);
    expect(title.props.numberOfLines).toBe(2);
    // The accessibility label still carries the whole title.
    expect(findByTestId(tree, "ask-source-1").props.accessibilityLabel).toBe(
      `Open task: ${sources[0]!.title}`,
    );
  });

  it("askSourceHeaderText: the detail carries no section word of its own (9.7 server)", () => {
    expect(
      askSourceHeaderText({ ref: 4, type: "task", id: ID, title: "Nap", section: "snoozed", detail: "until 15:00" }),
    ).toBe("[4] Snoozed · until 15:00");
    expect(askSourceHeaderText({ ref: 5, type: "note", id: ID, title: "Recipe" })).toBe("[5] Note");
  });

  it("renders a 9.7 source as [ref] <server section label> · <detail> · <title>", () => {
    const sources: AskSource[] = [
      { ref: 1, type: "task", id: ID, title: "Pay rent", section: "overdue", detail: "P1" },
      {
        ref: 2,
        type: "event",
        id: ID,
        title: "Standup",
        section: "event",
        detail: "14:30",
        occurs_at: "2026-09-14T19:30:00.000Z",
      },
      { ref: 3, type: "inbox_item", id: ID, title: "call the insurance guy", section: "capture" },
      { ref: 4, type: "task", id: ID, title: "Water plants", section: "due_today" },
      { ref: 5, type: "task", id: ID, title: "Taxes", section: "upcoming", detail: "Sep 16" },
      { ref: 6, type: "task", id: ID, title: "Gym", section: "reminder", detail: "07:00" },
      { ref: 7, type: "task", id: ID, title: "Old", section: "completed" },
      {
        ref: 8,
        type: "task",
        id: ID,
        title: "Ship 9.7",
        section: "project",
        detail: "Personal OS",
      },
      { ref: 9, type: "task", id: ID, title: "Nap", section: "snoozed", detail: "15:00" },
      { ref: 10, type: "note", id: ID, title: "Recipe", section: "record" },
    ];
    const tree = renderView({ state: { kind: "ready", response: response({ sources }) } });
    const row = (ref: number) =>
      `${getTextContent(findByTestId(tree, `ask-source-${ref}-header`))} · ${getTextContent(
        findByTestId(tree, `ask-source-${ref}-title`),
      )}`;
    expect(row(1)).toBe("[1] Overdue · P1 · Pay rent");
    expect(row(2)).toBe("[2] Event · 14:30 · Standup");
    expect(row(3)).toBe("[3] Capture · call the insurance guy");
    expect(row(4)).toBe("[4] Due today · Water plants");
    expect(row(5)).toBe("[5] Upcoming · Sep 16 · Taxes");
    expect(row(6)).toBe("[6] Reminder · 07:00 · Gym");
    expect(row(7)).toBe("[7] Completed · Old");
    expect(row(8)).toBe("[8] Project · Personal OS · Ship 9.7");
    expect(row(9)).toBe("[9] Snoozed · 15:00 · Nap");
    // `record` (a lexically matched row) reads as its type, exactly as 8.6B did.
    expect(row(10)).toBe("[10] Note · Recipe");
  });

  it("askSourceRowText: an event or capture with no section falls back to its type label", () => {
    expect(askSourceRowText({ ref: 1, type: "event", id: ID, title: "Dentist" })).toBe(
      "[1] Event · Dentist",
    );
    expect(askSourceRowText({ ref: 2, type: "inbox_item", id: ID, title: "buy milk" })).toBe(
      "[2] Capture · buy milk",
    );
    // An empty detail is omitted rather than rendered as a dangling separator.
    expect(askSourceRowText({ ref: 3, type: "task", id: ID, title: "x", detail: "" })).toBe(
      "[3] Task · x",
    );
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

describe("AskView -- citations_present (Checkpoint 9.7)", () => {
  it("renders the fixed 'cites nothing' line above the answer when the server says false", () => {
    const tree = renderView({
      state: { kind: "ready", response: response({ citations_present: false }) },
    });
    const line = findByTestId(tree, "ask-no-citations");
    expect(getTextContent(line)).toBe(ASK_NO_CITATIONS_COPY);
    expect(ASK_NO_CITATIONS_COPY).toBe("This answer cites nothing you can open.");
    // Above, not below: the container's first child is the notice.
    const container = findByTestId(tree, "ask-answer-container");
    const children = findAll(container, (n) => n.props?.testID !== undefined);
    expect(children[1]?.props?.testID).toBe("ask-no-citations");
    expect(children[2]?.props?.testID).toBe("ask-answer");
  });

  it("renders no such line when citations are present, or on an 8.6B-shaped response", () => {
    expect(
      findByTestId(
        renderView({ state: { kind: "ready", response: response({ citations_present: true }) } }),
        "ask-no-citations",
      ),
    ).toBeUndefined();
    expect(
      findByTestId(
        renderView({ state: { kind: "ready", response: response() } }),
        "ask-no-citations",
      ),
    ).toBeUndefined();
  });
});

describe("AskView -- preset chips (Checkpoint 9.7)", () => {
  it("renders the three chips, each labelled, none selected for free text", () => {
    const tree = renderView({ selectedPreset: null });
    expect(findByTestId(tree, "ask-presets")).toBeDefined();
    for (const preset of ASK_PRESETS) {
      const chip = findByTestId(tree, `ask-preset-${preset.key}`);
      expect(getTextContent(chip)).toBe(preset.label);
      expect(chip.props.accessibilityState.selected).toBe(false);
    }
  });

  it("marks exactly the selected chip", () => {
    const tree = renderView({ selectedPreset: "slipping" });
    expect(findByTestId(tree, "ask-preset-slipping").props.accessibilityState.selected).toBe(true);
    expect(findByTestId(tree, "ask-preset-focus").props.accessibilityState.selected).toBe(false);
    expect(findByTestId(tree, "ask-preset-tomorrow").props.accessibilityState.selected).toBe(false);
  });

  it("a chip tap hands back the exact preset definition, once, and nothing else", () => {
    const onSelectPreset = vi.fn();
    const onSubmit = vi.fn();
    const tree = renderView({ onSelectPreset, onSubmit });
    findByTestId(tree, "ask-preset-tomorrow").props.onPress();
    expect(onSelectPreset).toHaveBeenCalledTimes(1);
    expect(onSelectPreset).toHaveBeenCalledWith(ASK_PRESETS[2]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables every chip while a question is in flight", () => {
    const tree = renderView({ state: { kind: "submitting" } });
    for (const preset of ASK_PRESETS) {
      expect(findByTestId(tree, `ask-preset-${preset.key}`).props.disabled).toBe(true);
    }
  });

  it("the chips sit inside the ScrollView, above the input, so the keyboard cannot hide them", () => {
    const tree = renderView({});
    const scroll = findAll(tree, (n) => n.type === ScrollView)[0];
    expect(scroll).toBeDefined();
    const order = findAll(scroll, (n) => n.props?.testID !== undefined).map(
      (n) => n.props.testID as string,
    );
    expect(order.indexOf("ask-presets")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("ask-presets")).toBeLessThan(order.indexOf("ask-input"));
    expect(order.indexOf("ask-input")).toBeLessThan(order.indexOf("ask-submit"));
  });

  it("honours autoFocus so a deep-linked preset does not raise the keyboard", () => {
    expect(findByTestId(renderView({ autoFocus: true }), "ask-input").props.autoFocus).toBe(true);
    expect(findByTestId(renderView({ autoFocus: false }), "ask-input").props.autoFocus).toBe(false);
  });
});

describe("AskView -- nothing_today (Checkpoint 9.7)", () => {
  it("renders the fixed local answer, and no answer container or sources", () => {
    const tree = renderView({ state: { kind: "nothing_today", preset: "focus" } });
    expect(getTextContent(findByTestId(tree, "ask-nothing-today"))).toBe(ASK_NOTHING_TODAY_COPY);
    expect(ASK_NOTHING_TODAY_COPY).toBe("Nothing is due, scheduled or waiting today.");
    expect(findByTestId(tree, "ask-answer-container")).toBeUndefined();
    expect(findByTestId(tree, "ask-loading")).toBeUndefined();
  });

  it("answers the 'Summarize tomorrow' chip about the WINDOW it asked about, not today", () => {
    const tree = renderView({ state: { kind: "nothing_today", preset: "tomorrow" } });
    expect(getTextContent(findByTestId(tree, "ask-nothing-today"))).toBe(
      ASK_NOTHING_UPCOMING_COPY,
    );
    expect(ASK_NOTHING_UPCOMING_COPY).toBe("Nothing is due or scheduled in the next 7 days.");
  });

  it("askNothingCopyFor: only `tomorrow` speaks about the horizon", () => {
    expect(askNothingCopyFor("focus")).toBe(ASK_NOTHING_TODAY_COPY);
    expect(askNothingCopyFor("slipping")).toBe(ASK_NOTHING_TODAY_COPY);
    expect(askNothingCopyFor("tomorrow")).toBe(ASK_NOTHING_UPCOMING_COPY);
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
