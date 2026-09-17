// Render-level tests for <MemorySettingsCard /> (Checkpoint 10.7, ADR-077 §7).
//
// cloud-ask-card.test.tsx's technique: no render library, so the component
// is called directly with every hook it uses mocked, and the element tree it
// returns is walked. The card holds no `useState` for exactly this reason.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemorySettings, useUpdateMemorySettings } from "@/queries/memory";
import { MEMORY_PRIVACY_LINE } from "./memory-privacy";
import { MemorySettingsCard } from "./memory-settings-card";
import { MEMORY_OFF_NOTICE, memorySwitchPresentation } from "./memory-settings-card-state";

vi.mock("@/queries/memory", () => ({
  useMemorySettings: vi.fn(),
  useUpdateMemorySettings: vi.fn(),
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

function render(): unknown {
  return deepRender(MemorySettingsCard());
}

function mockSettings(overrides: Record<string, unknown> = {}) {
  vi.mocked(useMemorySettings).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { enabled: true, memory_count: 3 },
    ...overrides,
  } as never);
}

const mutate = vi.fn();

function mockUpdate(overrides: Record<string, unknown> = {}) {
  vi.mocked(useUpdateMemorySettings).mockReturnValue({
    isPending: false,
    isError: false,
    mutate,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettings();
  mockUpdate();
});

describe("memorySwitchPresentation (pure)", () => {
  it("loading has no chip and no toggle", () => {
    expect(
      memorySwitchPresentation({
        isLoading: true,
        isError: false,
        enabled: undefined,
        memoryCount: undefined,
      }),
    ).toEqual({ chip: null, statusText: "Loading…", toggleLabel: null });
  });

  it("an error is Unknown, with no toggle to press blind", () => {
    const view = memorySwitchPresentation({
      isLoading: false,
      isError: true,
      enabled: undefined,
      memoryCount: undefined,
    });
    expect(view.chip).toEqual({ label: "Unknown", tone: "warning" });
    expect(view.toggleLabel).toBeNull();
  });

  it("on and off each name the count and what the switch gates -- use, not storage", () => {
    const on = memorySwitchPresentation({
      isLoading: false,
      isError: false,
      enabled: true,
      memoryCount: 1,
    });
    expect(on).toEqual({
      chip: { label: "On", tone: "success" },
      statusText: "On — 1 memory. Focus Now and your briefing use them.",
      toggleLabel: "Turn off",
    });
    const off = memorySwitchPresentation({
      isLoading: false,
      isError: false,
      enabled: false,
      memoryCount: 2,
    });
    expect(off).toEqual({
      chip: { label: "Off", tone: "neutral" },
      statusText: "Off — 2 memories kept, not used by Focus Now or your briefing.",
      toggleLabel: "Turn on",
    });
  });

  it("the Memory Center's off notice says the memories are kept", () => {
    expect(MEMORY_OFF_NOTICE).toBe(
      "Memory is off — Focus Now and your briefing won't use it. Your memories are kept.",
    );
  });
});

describe("<MemorySettingsCard />", () => {
  it("shows On, the count and the byte-exact privacy line when enabled", () => {
    const tree = render();
    const card = findByTestId(tree, "memory-settings-card");
    expect(getTextContent(card)).toContain("On");
    expect(getTextContent(findByTestId(tree, "memory-settings-status"))).toBe(
      "On — 3 memories. Focus Now and your briefing use them.",
    );
    expect(getTextContent(findByTestId(tree, "memory-privacy-line"))).toBe(MEMORY_PRIVACY_LINE);
  });

  it("the status line is a polite live region", () => {
    const status = findByTestId(render(), "memory-settings-status");
    expect(status.props.accessibilityLiveRegion).toBe("polite");
  });

  it("offers Open Memory as a row into /memory", () => {
    const row = findByTestId(render(), "memory-settings-open");
    expect(row).toBeDefined();
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe("Open Memory");
  });

  it("the toggle is a reversible Button (no Switch, no confirm): Turn off when on, mutating to false", () => {
    const toggle = findByTestId(render(), "memory-settings-toggle");
    expect(getTextContent(toggle)).toBe("Turn off");
    expect(toggle.props.accessibilityLabel).toBe("Turn Memory off");
    toggle.props.onPress();
    expect(mutate).toHaveBeenCalledWith(false);
  });

  it("reads Turn on when off, mutating to true", () => {
    mockSettings({ data: { enabled: false, memory_count: 0 } });
    const toggle = findByTestId(render(), "memory-settings-toggle");
    expect(getTextContent(toggle)).toBe("Turn on");
    toggle.props.onPress();
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it("is busy while the switch is flipping and does not re-fire", () => {
    mockUpdate({ isPending: true });
    const toggle = findByTestId(render(), "memory-settings-toggle");
    expect(toggle.props.accessibilityState).toEqual({ disabled: true, busy: true });
    toggle.props.onPress();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows no toggle while loading or unknown, and an alert line on a failed flip", () => {
    mockSettings({ isLoading: true, data: undefined });
    expect(findByTestId(render(), "memory-settings-toggle")).toBeUndefined();
    mockSettings({ isError: true, data: undefined });
    expect(findByTestId(render(), "memory-settings-toggle")).toBeUndefined();
    mockSettings();
    mockUpdate({ isError: true });
    const error = findByTestId(render(), "memory-settings-error");
    expect(error.props.accessibilityRole).toBe("alert");
  });

  it("never renders a Switch and never a delete-all control", () => {
    const tree = render();
    expect(findAll(tree, (n) => n.type?.displayName === "Switch")).toEqual([]);
    expect(getTextContent(tree)).not.toMatch(/Delete all/);
  });
});
