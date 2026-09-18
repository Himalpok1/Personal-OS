// Render-level tests for <ActionsSettingsCard /> (Checkpoint 10.8, ADR-078 §8).
//
// memory-settings-card.test.tsx's technique: no render library, so the
// component is called directly with its one query hook mocked, and the
// element tree it returns is walked.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActionsSummary } from "@/queries/actions";
import { ActionsSettingsCard } from "./actions-settings-card";
import { actionsSettingsPresentation } from "./actions-settings-card-state";
import { summary } from "./fixtures.test-support";
import { ACTIONS_TRUST_LINE } from "./trust-line";

vi.mock("@/queries/actions", () => ({ useActionsSummary: vi.fn() }));

const push = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));

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

function mockSummary(overrides: Record<string, unknown> = {}) {
  vi.mocked(useActionsSummary).mockReturnValue({
    isLoading: false,
    isError: false,
    data: summary(),
    ...overrides,
  } as never);
}

function render(): unknown {
  return deepRender(ActionsSettingsCard());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSummary();
});

describe("actionsSettingsPresentation (pure)", () => {
  it("loading has no chip", () => {
    expect(
      actionsSettingsPresentation({ isLoading: true, isError: false, summary: undefined }),
    ).toEqual({ chip: null, capabilitiesLine: "Loading…" });
  });

  it("an error is Unknown", () => {
    const view = actionsSettingsPresentation({
      isLoading: false,
      isError: true,
      summary: undefined,
    });
    expect(view.chip).toEqual({ label: "Unknown", tone: "warning" });
  });

  it("pending reads as N waiting, otherwise Up to date; the caption counts capabilities", () => {
    expect(
      actionsSettingsPresentation({ isLoading: false, isError: false, summary: summary() }),
    ).toEqual({
      chip: { label: "2 waiting", tone: "warning" },
      capabilitiesLine: "2 of 2 capabilities allowed",
    });
    expect(
      actionsSettingsPresentation({
        isLoading: false,
        isError: false,
        summary: summary({ pending_total: 0, permissions_granted: 1 }),
      }),
    ).toEqual({
      chip: { label: "Up to date", tone: "success" },
      capabilitiesLine: "1 of 2 capabilities allowed",
    });
  });
});

describe("<ActionsSettingsCard />", () => {
  it("shows the waiting chip, the byte-exact trust line and the capabilities caption", () => {
    const tree = render();
    expect(getTextContent(findByTestId(tree, "actions-settings-card"))).toContain("2 waiting");
    expect(getTextContent(findByTestId(tree, "actions-trust-line"))).toBe(ACTIONS_TRUST_LINE);
    expect(getTextContent(findByTestId(tree, "actions-settings-capabilities"))).toBe(
      "2 of 2 capabilities allowed",
    );
  });

  it("offers Open Action Center as a row into /actions", () => {
    const row = findByTestId(render(), "actions-settings-open");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe("Open Action Center");
    row.props.onPress();
    expect(push).toHaveBeenCalledWith("/actions");
  });

  it("reads Up to date with nothing pending, and Unknown on an error", () => {
    mockSummary({ data: summary({ pending_total: 0 }) });
    expect(getTextContent(render())).toContain("Up to date");
    mockSummary({ isError: true, data: undefined });
    expect(getTextContent(render())).toContain("Unknown");
  });

  it("carries no toggle, no Switch and no approve control -- every write lives in the Action Center", () => {
    const tree = render();
    expect(findAll(tree, (n) => n.type?.displayName === "Switch")).toEqual([]);
    const pressables = findAll(tree, (n) => n.type === Pressable);
    expect(pressables).toHaveLength(1);
    expect(pressables[0].props.accessibilityLabel).toBe("Open Action Center");
  });
});
