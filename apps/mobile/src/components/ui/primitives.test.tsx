// Render-level tests for the design-system primitives (Checkpoint 10.3),
// in the tree-walking idiom every mobile component test uses (no render
// library; hooks resolve to the vitest aliases for nativewind, expo-haptics,
// expo-linear-gradient and @expo/vector-icons).
import { Platform, Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Haptics from "expo-haptics";
import { Button, IconButton, buttonClasses } from "./button";
import { Card, GradientCard, cardClass } from "./card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { triggerHaptic } from "./haptics";
import { ListRow } from "./list-row";
import { MetricCard } from "./metric-card";
import { ProgressBar, clampProgress } from "./progress-bar";
import { SectionHeader, sectionTitleText } from "./section-header";
import { StatusChip, chipClasses } from "./status-chip";
import { textClass } from "./text";
import { tokens } from "./theme";
import { applyWebColorSchemeClass, followSystemColorSchemeOnWeb } from "./web-color-scheme";
import * as NativeWind from "nativewind";

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

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

function text(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const el = node as { props?: { children?: unknown } };
  return el.props?.children === undefined ? "" : text(el.props.children);
}

const pressables = (tree: unknown) => findAll(tree, (n) => n.type === Pressable);

beforeEach(() => vi.clearAllMocks());

describe("Card", () => {
  it("is an inert View without onPress and a button Pressable with one", () => {
    const inert = deepRender(<Card>{null}</Card>) as any;
    expect(inert.type).toBe(View);
    const pressed = deepRender(
      <Card onPress={() => {}} accessibilityLabel="Open">
        {null}
      </Card>,
    ) as any;
    expect(pressed.type).toBe(Pressable);
    expect(pressed.props.accessibilityRole).toBe("button");
    expect(pressed.props.accessibilityLabel).toBe("Open");
  });

  it("never carries a raw colour: every colour is a token class", () => {
    const classes = cardClass("md", "card", "mt-2");
    expect(classes).toContain("bg-surface");
    expect(classes).toContain("dark:bg-surface-dark");
    expect(classes).toContain("rounded-card");
    expect(classes).toContain("mt-2");
    expect(classes).not.toMatch(/#|neutral-|white|black/);
  });

  it("GradientCard picks the preset's stops for the current scheme", () => {
    const tree = deepRender(<GradientCard gradient="academic">{null}</GradientCard>);
    const gradient = findAll(tree, (n) => Array.isArray(n.props?.colors))[0];
    expect(gradient.props.colors).toEqual(tokens.gradients.academic.light);
  });
});

describe("Button", () => {
  it("fires a light haptic on a primary press and none on a tonal one (on a device)", () => {
    // react-native-web reports Platform.OS "web", where haptics are a no-op
    // by design; the device contract is exercised by pretending to be Android
    // for the length of this test.
    const platform = Platform as unknown as { OS: string };
    const previous = platform.OS;
    platform.OS = "android";
    const impact = vi.spyOn(Haptics, "impactAsync");
    try {
      const onPress = vi.fn();
      const primary = deepRender(<Button label="Go" onPress={onPress} />) as any;
      primary.props.onPress();
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(impact).toHaveBeenCalledTimes(1);
      expect(impact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
      const tonal = deepRender(<Button label="Go" onPress={onPress} variant="tonal" />) as any;
      tonal.props.onPress();
      expect(onPress).toHaveBeenCalledTimes(2);
      expect(impact).toHaveBeenCalledTimes(1);
      // An explicit opt-out silences a primary button (navigation buttons).
      const nav = deepRender(<Button label="New" onPress={onPress} haptic={false} />) as any;
      nav.props.onPress();
      expect(impact).toHaveBeenCalledTimes(1);
      // The named kinds map to the right expo-haptics call.
      const notify = vi.spyOn(Haptics, "notificationAsync");
      triggerHaptic("success");
      expect(notify).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
      notify.mockRestore();
    } finally {
      platform.OS = previous;
      impact.mockRestore();
    }
  });

  it("is inert while busy and says so to assistive tech", () => {
    const onPress = vi.fn();
    const busy = deepRender(<Button label="Save" onPress={onPress} busy />) as any;
    busy.props.onPress();
    expect(onPress).not.toHaveBeenCalled();
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(text(busy)).toBe("Save…");
  });

  it("every variant is a 44px-minimum button with a label", () => {
    for (const variant of ["primary", "tonal", "outline", "ghost", "danger"] as const) {
      const classes = buttonClasses(variant, "sm", false);
      expect(classes.container).toContain("min-h-[44px]");
      expect(classes.label.length).toBeGreaterThan(0);
    }
    const icon = deepRender(
      <IconButton icon="magnify" onPress={() => {}} accessibilityLabel="Search" />,
    ) as any;
    expect(icon.props.accessibilityRole).toBe("button");
    expect(icon.props.accessibilityLabel).toBe("Search");
    expect(icon.props.className).toContain("h-11 w-11");
  });
});

describe("StatusChip", () => {
  it("maps every tone to a container/label pair from the palette", () => {
    for (const tone of ["neutral", "primary", "success", "warning", "danger", "info"] as const) {
      const c = chipClasses(tone, "sm");
      expect(c.container).toContain("rounded-full");
      expect(c.container).toMatch(/bg-[a-z-]+ dark:bg-[a-z-]+-dark/);
      expect(c.label).toMatch(/text-[a-z-]+ dark:text-[a-z-]+-dark/);
    }
  });

  it("is never pressable and reads its label", () => {
    const tree = deepRender(<StatusChip label="Behind" tone="danger" dot />);
    expect(pressables(tree)).toHaveLength(0);
    expect(text(tree)).toBe("Behind");
    expect((tree as any).props.accessibilityLabel).toBe("Behind");
  });
});

describe("ProgressBar", () => {
  it("clamps to [0, 1] and treats NaN as empty", () => {
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(-0.2)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(0.42)).toBe(0.42);
  });

  it("exposes a progressbar role with a percentage value", () => {
    const tree = deepRender(<ProgressBar value={0.426} accessibilityLabel="Graded" />) as any;
    expect(tree.props.accessibilityRole).toBe("progressbar");
    expect(tree.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 43 });
    const fill = findAll(tree, (n) => n.props?.style?.width !== undefined)[0];
    expect(fill.props.style.width).toBe("42.6%");
  });
});

describe("SectionHeader / MetricCard / ListRow", () => {
  it("renders `Title · N` and an action button", () => {
    expect(sectionTitleText("Overdue", 2)).toBe("Overdue · 2");
    expect(sectionTitleText("Events")).toBe("Events");
    const onPress = vi.fn();
    const tree = deepRender(
      <SectionHeader title="Do next" count={3} action={{ label: "All", onPress }} />,
    );
    expect(text(tree)).toContain("Do next · 3");
    const [action] = pressables(tree);
    expect(action.props.accessibilityLabel).toBe("All");
    action.props.onPress();
    expect(onPress).toHaveBeenCalled();
  });

  it("MetricCard speaks its label, value, unit and caption as one label", () => {
    const tree = deepRender(
      <MetricCard label="Steps" value="6,120" unit="steps" caption="today" onPress={() => {}} />,
    ) as any;
    expect(tree.props.accessibilityLabel).toBe("Steps 6,120 steps, today");
  });

  it("ListRow is a labelled button when pressable and a plain View otherwise", () => {
    const row = deepRender(
      <ListRow title="Homework 4" subtitle="MATH" onPress={() => {}} chevron />,
    ) as any;
    expect(row.type).toBe(Pressable);
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe("Homework 4");
    expect(row.props.className).toContain("min-h-[52px]");
    const inert = deepRender(<ListRow title="Quiz" last />) as any;
    expect(inert.type).toBe(View);
    expect(inert.props.className).not.toContain("border-b");
    // A row wrapping its own control drops the button role so web never
    // nests one <button> inside another; the label stays.
    const wrapping = deepRender(
      <ListRow title="Task" onPress={() => {}} containsControl leading={<View />} />,
    ) as any;
    expect(wrapping.type).toBe(Pressable);
    expect(wrapping.props.accessibilityRole).toBeUndefined();
    expect(wrapping.props.accessibilityLabel).toBe("Task");
  });
});

describe("EmptyState / ErrorState", () => {
  it("EmptyState renders title, body and at most one action", () => {
    const onPress = vi.fn();
    const tree = deepRender(
      <EmptyState
        icon="inbox-outline"
        title="Inbox is clear"
        body="Nothing waiting."
        action={{ label: "Capture", onPress }}
      />,
    );
    expect(text(tree)).toContain("Inbox is clear");
    expect(text(tree)).toContain("Nothing waiting.");
    const buttons = pressables(tree);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe("Capture");
  });

  it("ErrorState is an alert with a retry that carries its own label", () => {
    const onRetry = vi.fn();
    const tree = deepRender(
      <ErrorState
        message="Couldn't load today."
        onRetry={onRetry}
        retryAccessibilityLabel="Retry loading today"
      />,
    ) as any;
    expect(tree.props.accessibilityRole).toBe("alert");
    const [retry] = pressables(tree);
    expect(retry.props.accessibilityLabel).toBe("Retry loading today");
    retry.props.onPress();
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("text vocabulary and web dark class", () => {
  it("textClass composes a size variant, a tone and layout classes", () => {
    expect(textClass("display", "default", "mt-1")).toBe(
      "text-display font-bold text-on-surface dark:text-on-surface-dark mt-1",
    );
    expect(textClass("caption", "inherit")).toBe("text-caption");
  });

  it("triggerHaptic never throws, and is a no-op on web (react-native-web reports Platform.OS web)", () => {
    const spy = vi.spyOn(Haptics, "notificationAsync");
    expect(() => triggerHaptic("success")).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("followSystemColorSchemeOnWeb asks the runtime to follow the OS once, and only on web", () => {
    const set = vi.spyOn(NativeWind.colorScheme, "set");
    vi.stubGlobal("document", { documentElement: { classList: { toggle: vi.fn() } } });
    try {
      followSystemColorSchemeOnWeb();
      followSystemColorSchemeOnWeb();
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith("system");
    } finally {
      vi.unstubAllGlobals();
      set.mockRestore();
    }
  });

  it("applyWebColorSchemeClass toggles the `dark` class on the document root", () => {
    const classList = { toggle: vi.fn() };
    vi.stubGlobal("document", { documentElement: { classList } });
    try {
      applyWebColorSchemeClass("dark");
      expect(classList.toggle).toHaveBeenCalledWith("dark", true);
      applyWebColorSchemeClass("light");
      expect(classList.toggle).toHaveBeenCalledWith("dark", false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
