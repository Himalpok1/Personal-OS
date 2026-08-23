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
import { BriefCard } from "./brief-card";

vi.mock("@/queries/brief", () => ({
  useCurrentBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
}));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

// Expands any app-defined function component (e.g. the local ActionButton)
// into its actual rendered output, recursively, while leaving react-native's
// own host components (View/Text/Pressable) untouched as leaves. Safe here
// because every such component in this tree is a plain, hookless function of
// its props -- there is no internal state to lose by invoking it directly.
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
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[0].props.accessibilityState).toEqual({ disabled: true });
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
