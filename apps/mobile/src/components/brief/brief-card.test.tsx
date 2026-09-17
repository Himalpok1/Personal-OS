// Render-level tests for <BriefCard /> -- an audit found the component had
// zero coverage above resolveBriefCardState's pure-logic tests
// (brief-card-state.test.ts), leaving three load-bearing invariants
// protected only by code reading:
//   1. a cached brief's prose must survive a failed regeneration attempt
//      (never destroyed by an error);
//   2. the no_provider (409) state must never be a dead end -- it still
//      offers a real action, not just a message;
//   3. the "Generating..." control must actually be disabled (the prop, not
//      just its label) so a double-tap cannot fire two generations.
//
// This app has no @testing-library/react-native (or any render library) in
// its dependencies -- confirmed via apps/mobile/package.json and by reading
// the two existing render-style tests in this codebase,
// recurrence-editor.test.tsx and __tests__/events-screen.test.tsx. Both call
// the component function directly (no renderer) and walk the plain React
// element tree it returns with hand-rolled testID/text-content helpers. This
// file copies that exact technique.
//
// One wrinkle those two files didn't have to deal with: every interactive
// element in RecurrenceEditor/EditEventView carries its own testID directly,
// so their tree-walkers never need to expand a nested custom component.
// BriefCard's buttons are wrapped in a local, unexported <ActionButton />
// (no testID of its own), so this file adds a small deepRender step that
// expands app-defined function components (ActionButton) while leaving
// react-native's own View/Text/Pressable as leaves -- identified by
// reference equality against the same aliased "react-native" import
// brief-card.tsx uses (see vitest.config.ts's react-native -> react-native-web
// alias), not by guessing at internal shapes.
//
// BriefCard itself calls two hooks -- useCurrentBrief/useGenerateBrief --
// directly (unlike RecurrenceEditor/EditEventView, which are pure
// prop-driven views with no hooks of their own). Calling BriefCard()
// directly only works because those two hooks are mocked below to return
// plain objects with no real React hook underneath -- there is no live
// dispatcher, so any *unmocked* hook call would throw. resolveBriefCardState
// itself is plain, hookless logic, so it runs safely inside the direct call.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentBrief, useGenerateBrief } from "@/queries/brief";
import { ClampedText } from "@/components/ui";
import { BRIEF_COLLAPSED_LINES, BriefCard } from "./brief-card";

vi.mock("@/queries/brief", () => ({
  useCurrentBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
}));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

// Expands any app-defined function component (e.g. the local ActionButton)
// into its actual rendered output, recursively, while leaving react-native's
// own host components (View/Text/Pressable) untouched as leaves. Safe here
// because every such function component in this tree is a plain, hookless
// function of its props -- there is no internal state to lose by invoking it
// directly.
//
// ClampedText (Checkpoint 10.6; the class component ClampedBriefText was
// until then) is the one exception: it's a class component (see
// components/ui/clamped-text.tsx's comment on why), so `typeof el.type ===
// "function"` is true for it too (ES6 classes are functions), but it cannot
// be invoked without `new`. Detected via `Component.prototype.isReactComponent`, the
// same stable marker React itself uses to tell class components apart from
// plain functions -- not an internals hack. Instantiated directly and its
// render() output is walked exactly like any other node; its own dedicated
// tests below construct instances directly for state control instead of
// going through this path.
function isClassComponentType(
  type: unknown,
): type is new (props: unknown) => { render: () => unknown } {
  return (
    typeof type === "function" &&
    typeof (type as { prototype?: unknown }).prototype === "object" &&
    (type as { prototype: { isReactComponent?: unknown } }).prototype.isReactComponent != null
  );
}

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;

  if (isClassComponentType(el.type)) {
    const instance = new el.type(el.props ?? {});
    return deepRender(instance.render());
  }

  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    const rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    return deepRender(rendered);
  }

  if (el.props && "children" in el.props) {
    return {
      ...el,
      props: { ...el.props, children: deepRender(el.props.children) },
    };
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

function findButtons(node: unknown): any[] {
  return findAll(node, (n) => n.type === Pressable);
}

function renderBriefCard(): unknown {
  return deepRender(BriefCard());
}

const CACHED_BRIEF = {
  content: { text: "Yesterday you finished the deploy checklist. Today: 2 overdue tasks." },
  generated_at: "2026-08-22T13:00:00.000Z",
};

describe("<BriefCard />", () => {
  beforeEach(() => {
    vi.mocked(useCurrentBrief).mockReset();
    vi.mocked(useGenerateBrief).mockReset();
  });

  it("PRESENT: renders the brief prose and a Regenerate control", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: CACHED_BRIEF,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: null,
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();
    const text = getTextContent(tree);

    expect(text).toContain(CACHED_BRIEF.content.text);
    expect(text).toContain("Generated");

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Regenerate");
    expect(buttons[0].props.disabled).toBeFalsy();
  });

  it("PRESENT: clamps the prose through the design system's ClampedText at the Brief's own budget (10.6)", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: CACHED_BRIEF,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: null,
      mutate: vi.fn(),
    } as any);

    // Before deepRender expands it: the element the card hands the clamp.
    const clamp = findAll(BriefCard(), (n) => n.type === ClampedText);
    expect(clamp).toHaveLength(1);
    expect(clamp[0].props.text).toBe(CACHED_BRIEF.content.text);
    expect(clamp[0].props.lines).toBe(BRIEF_COLLAPSED_LINES);
  });

  it("NO_PROVIDER: the line is one compact EmptyState row with the action inside it (10.6)", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: null,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: {
        status: 409,
        code: "no_provider_configured",
        body: { error: "no_provider_configured" },
      },
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();
    // The compact row is one accessible group whose label carries the sentence.
    const rows = findAll(
      tree,
      (n) =>
        n.type === View &&
        typeof n.props?.accessibilityLabel === "string" &&
        n.props.accessibilityLabel.startsWith("No AI provider is configured"),
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0].props.className)).toContain("min-h-[44px]");
    expect(findButtons(rows[0])).toHaveLength(1);
    expect(getTextContent(findButtons(rows[0])[0])).toBe("Try again");
  });

  it("ERROR WITH CACHED BRIEF: a failed regeneration never destroys the visible cached prose", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: CACHED_BRIEF,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: new Error("network request failed"),
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();
    const text = getTextContent(tree);

    // The frozen invariant: the PREVIOUS prose is still on screen, alongside
    // the error and a Retry control -- a failed regeneration must never
    // blank out an already-cached, still-valid brief.
    expect(text).toContain(CACHED_BRIEF.content.text);
    expect(text).toContain("Couldn't generate the daily brief.");

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Retry");
    expect(buttons[0].props.disabled).toBeFalsy();
  });

  it("NO_PROVIDER: a 409 no_provider_configured error is calm, keeps cached prose, and is never a dead end", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: CACHED_BRIEF,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: { status: 409, code: "no_provider_configured", body: { error: "no_provider_configured" } },
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();
    const text = getTextContent(tree);

    expect(text).toContain(CACHED_BRIEF.content.text);
    expect(text).toContain("No AI provider is configured for daily briefs.");

    // Not a dead end: a real, enabled action is offered, not just a message.
    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Try again");
    expect(buttons[0].props.disabled).toBeFalsy();
    expect(buttons[0].props.accessibilityState?.disabled).toBeFalsy();
  });

  it("GENERATING: the action control is actually disabled, not just relabeled, so a double-tap can't fire twice", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: CACHED_BRIEF,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: true,
      error: null,
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Generating…");
    // Assert the actual prop/accessibilityState, not just the visible label.
    // (Checkpoint 10.3: the design-system Button also reports `busy`, so the
    // state is matched on `disabled` rather than as an exact object.)
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[0].props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("EMPTY: renders Generate Daily Brief with no cached brief and no error", () => {
    vi.mocked(useCurrentBrief).mockReturnValue({
      isLoading: false,
      data: null,
      error: null,
    } as any);
    vi.mocked(useGenerateBrief).mockReturnValue({
      isPending: false,
      error: null,
      mutate: vi.fn(),
    } as any);

    const tree = renderBriefCard();
    const text = getTextContent(tree);

    expect(text).toContain("Generate Daily Brief");

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Generate Daily Brief");
    expect(buttons[0].props.disabled).toBeFalsy();
  });
});

// The Brief's line-clamp/expand behavior (Checkpoint 5.6) is now the design
// system's ClampedText (Checkpoint 10.6, ADR-076 §3), constructed here with
// the Brief's own line budget so every invariant the retired ClampedBriefText
// carried is still pinned from this card's side. Constructed directly
// (bypassing React.createElement) exactly like the class-component-detection
// comment on deepRender above explains -- this gives full control over its
// instance state without needing a real renderer.
//
// One consequence of bare instantiation worth calling out: `this.setState`
// on a class instance that was never mounted through a real reconciler is a
// documented React no-op (it warns and does not touch `this.state`), so
// these tests split into two techniques rather than one:
//   - Behavior of handleMeasureLayout/toggleExpanded/componentDidUpdate is
//     verified by spying on `setState` and asserting what it was (or wasn't)
//     called with -- this is what actually exercises the decision logic.
//   - render() output for a *given* state is verified by constructing an
//     instance already in that state (Object.assign onto the class-field
//     default) -- this is what exercises the rendered tree.
describe("<ClampedText /> as the Brief's clamp", () => {
  const TEXT_CLASS = "text-sm leading-5 text-neutral-700 dark:text-neutral-300";

  function makeInstance(
    text: string,
    initialState?: Partial<{ expanded: boolean; isClamped: boolean }>,
  ): ClampedText {
    const instance = new ClampedText({
      text,
      lines: BRIEF_COLLAPSED_LINES,
      textClassName: TEXT_CLASS,
    });
    if (initialState) Object.assign(instance.state, initialState);
    return instance;
  }

  // A real onTextLayout event only ever needs `nativeEvent.lines.length` for
  // this component's logic -- everything else on the real event shape is
  // irrelevant here.
  function fakeLayoutEvent(lineCount: number): any {
    return { nativeEvent: { lines: Array.from({ length: lineCount }, () => ({})) } };
  }

  function visibleTextNode(tree: unknown): any {
    // The visible Text is the one WITHOUT onTextLayout -- the hidden
    // measurement Text is the one with it.
    return findAll(tree, (n) => n.type === Text && n.props?.onTextLayout === undefined)[0];
  }

  it("shows no toggle before any real line count has been measured", () => {
    const instance = makeInstance("A short brief.");
    const tree = deepRender(instance.render());

    expect(findButtons(tree)).toHaveLength(0);
    expect(visibleTextNode(tree).props.numberOfLines).toBe(BRIEF_COLLAPSED_LINES);
  });

  it("does not offer a toggle for text that measures within the collapse budget -- exactly at the budget does not count as clamped", () => {
    const instance = makeInstance("A brief.");
    const setStateSpy = vi.spyOn(instance, "setState");

    instance.handleMeasureLayout(fakeLayoutEvent(BRIEF_COLLAPSED_LINES));

    expect(setStateSpy).not.toHaveBeenCalled();
  });

  it("flags text as clamped only once the real measured line count exceeds the budget -- never guessing from string length", () => {
    // Deliberately short string, to prove the decision comes from the fake
    // layout event alone, not from string length.
    const instance = makeInstance("x");
    const setStateSpy = vi.spyOn(instance, "setState");

    instance.handleMeasureLayout(fakeLayoutEvent(BRIEF_COLLAPSED_LINES + 1));

    expect(setStateSpy).toHaveBeenCalledExactlyOnceWith({ isClamped: true });
  });

  it("does not re-call setState for a repeat measurement that doesn't change the clamped verdict", () => {
    const instance = makeInstance("A long brief.", { isClamped: true });
    const setStateSpy = vi.spyOn(instance, "setState");

    instance.handleMeasureLayout(fakeLayoutEvent(BRIEF_COLLAPSED_LINES + 5));

    expect(setStateSpy).not.toHaveBeenCalled();
  });

  it("renders a >=44px, accessible 'Show more' toggle once clamped, and clamps the visible text to the collapse budget", () => {
    const instance = makeInstance("A long brief.", { isClamped: true, expanded: false });
    const tree = deepRender(instance.render());

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Show more");
    expect(buttons[0].props.accessibilityRole).toBe("button");
    expect(buttons[0].props.accessibilityState).toEqual({ expanded: false });
    expect(buttons[0].props.hitSlop).toBe(8);
    expect(String(buttons[0].props.className)).toContain("min-h-[44px]");

    expect(visibleTextNode(tree).props.numberOfLines).toBe(BRIEF_COLLAPSED_LINES);
  });

  it("expanded state shows the full, unclamped text and flips the toggle to 'Show less'", () => {
    const instance = makeInstance("A long brief.", { isClamped: true, expanded: true });
    const tree = deepRender(instance.render());

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Show less");
    expect(buttons[0].props.accessibilityState).toEqual({ expanded: true });
    expect(visibleTextNode(tree).props.numberOfLines).toBeUndefined();
  });

  it("toggleExpanded flips the expanded flag via a functional setState update", () => {
    const instance = makeInstance("A long brief.", { isClamped: true, expanded: false });
    const setStateSpy = vi.spyOn(instance, "setState");

    instance.toggleExpanded();

    expect(setStateSpy).toHaveBeenCalledTimes(1);
    const updater = setStateSpy.mock.calls[0]![0] as unknown as (prev: {
      expanded: boolean;
    }) => { expanded: boolean };
    expect(updater({ expanded: false })).toEqual({ expanded: true });
    expect(updater({ expanded: true })).toEqual({ expanded: false });
  });

  it("does not reset when componentDidUpdate fires but the text is unchanged", () => {
    const instance = makeInstance("Same text.", { isClamped: true, expanded: true });
    const setStateSpy = vi.spyOn(instance, "setState");

    instance.componentDidUpdate({
      text: "Same text.",
      lines: BRIEF_COLLAPSED_LINES,
      textClassName: TEXT_CLASS,
    });

    expect(setStateSpy).not.toHaveBeenCalled();
  });

  it("resets expanded/measured state when the underlying brief text changes -- a regenerate must not leave a stale expanded view of the old text", () => {
    const instance = makeInstance("Old text.", { isClamped: true, expanded: true });
    const setStateSpy = vi.spyOn(instance, "setState");
    const prevProps = {
      text: "Old text.",
      lines: BRIEF_COLLAPSED_LINES,
      textClassName: TEXT_CLASS,
    };

    // Simulate React having already applied the new props to the instance
    // before invoking the lifecycle hook with the previous ones -- exactly
    // how React calls componentDidUpdate.
    (instance as unknown as { props: typeof prevProps }).props = {
      text: "New text.",
      lines: BRIEF_COLLAPSED_LINES,
      textClassName: TEXT_CLASS,
    };
    instance.componentDidUpdate(prevProps);

    expect(setStateSpy).toHaveBeenCalledExactlyOnceWith({ expanded: false, isClamped: false });
  });
});
