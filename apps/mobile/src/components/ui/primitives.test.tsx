// Render-level tests for the design-system primitives (Checkpoint 10.3),
// in the tree-walking idiom every mobile component test uses (no render
// library; hooks resolve to the vitest aliases for nativewind, expo-haptics,
// expo-linear-gradient and @expo/vector-icons).
import { Platform, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Haptics from "expo-haptics";
import { AnimatedNumberCounter } from "./animated-number";
import { Button, IconButton, buttonClasses } from "./button";
import { Card, GradientCard, cardClass, softCardClass } from "./card";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { triggerHaptic } from "./haptics";
import { ListRow, TRAILING_CHIP_CAP, trailingChipsVisible } from "./list-row";
import { MetricCard, metricAnimatedValue, metricSpokenLabel } from "./metric-card";
import { enterRise } from "./motion";
import { ProgressBar, clampProgress } from "./progress-bar";
import { useRefreshControl } from "./screen";
import { SectionHeader, sectionTitleText } from "./section-header";
import { StatusChip, chipClasses } from "./status-chip";
import { textClass } from "./text";
import { LIGHT_COLORS, tokens } from "./theme";
import { applyWebColorSchemeClass, followSystemColorSchemeOnWeb } from "./web-color-scheme";
import * as NativeWind from "nativewind";

// Checkpoint 10.6: the animated counter is a leaf with a React effect, so
// the walk stops at it (interactions.test.tsx explains the rule).
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, TextInput, AnimatedNumberCounter]);

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

// Checkpoint 10.6 additions to the existing primitives. Every test above
// still passes unchanged; these pin only what was added.
describe("10.6 additions", () => {
  it("IconButton is inert while busy or disabled and says so", () => {
    const onPress = vi.fn();
    const busy = deepRender(
      <IconButton
        icon="archive-arrow-down-outline"
        onPress={onPress}
        accessibilityLabel="Archive"
        busy
      />,
    ) as any;
    busy.props.onPress();
    expect(onPress).not.toHaveBeenCalled();
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(busy.props.className).toContain("opacity-50");
    const live = deepRender(
      <IconButton
        icon="archive-arrow-down-outline"
        onPress={onPress}
        accessibilityLabel="Archive"
      />,
    ) as any;
    live.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(live.props.accessibilityState).toEqual({ disabled: false, busy: false });
    // Buttons keep their own active classes: no stacked opacity fallback.
    expect(live.props.className).not.toContain("active:opacity-80");
    expect(live.props.className).toContain("active:opacity-70");
  });

  it("a pressable Card keeps the opacity fallback on web and every class it was given", () => {
    const pressed = deepRender(
      <Card onPress={() => {}} className="flex-1 mt-2">
        {null}
      </Card>,
    ) as any;
    expect(pressed.type).toBe(Pressable);
    expect(pressed.props.className).toContain("flex-1 mt-2");
    expect(pressed.props.className).toContain("active:opacity-80");
    expect(pressed.props.hitSlop).toBe(4);
  });

  it("Card variant=soft draws the soft gradient under the children with no surface token", () => {
    expect(softCardClass("md", "mt-2")).toBe("overflow-hidden rounded-card p-4 mt-2");
    expect(softCardClass("none")).not.toContain("bg-");
    const tree = deepRender(
      <Card variant="soft">
        <View testID="inner" />
      </Card>,
    ) as any;
    expect(tree.type).toBe(View);
    expect(tree.props.className).toBe("overflow-hidden rounded-card p-4");
    const gradient = findAll(tree, (n) => Array.isArray(n.props?.colors))[0];
    expect(gradient.props.colors).toEqual(tokens.gradients.soft.light);
    expect(gradient.props.pointerEvents).toBe("none");
    expect(findAll(tree, (n) => n.props?.testID === "inner")).toHaveLength(1);
    // The ordinary card draws no gradient layer at all.
    const plain = deepRender(<Card>{null}</Card>);
    expect(findAll(plain, (n) => Array.isArray(n.props?.colors))).toHaveLength(0);
  });

  it("ListRow caps trailing chips at two and collapses the rest to +N", () => {
    const chips = [
      { label: "Missing", tone: "danger" as const },
      { label: "Late", tone: "warning" as const },
      { label: "Graded", tone: "success" as const },
    ];
    expect(TRAILING_CHIP_CAP).toBe(2);
    expect(trailingChipsVisible(chips)).toEqual({ shown: chips.slice(0, 2), overflow: 1 });
    expect(trailingChipsVisible(chips.slice(0, 1))).toEqual({
      shown: chips.slice(0, 1),
      overflow: 0,
    });
    const tree = deepRender(<ListRow title="Essay" trailingChips={chips} chevron last />);
    expect(text(tree)).toContain("Missing");
    expect(text(tree)).toContain("Late");
    expect(text(tree)).not.toContain("Graded");
    expect(text(tree)).toContain("+1");
    const overflow = findAll(tree, (n) => n.props?.accessibilityLabel === "1 more");
    expect(overflow).toHaveLength(1);
    // The chevron still follows the chips when there is no explicit trailing.
    expect(
      findAll(tree, (n) => n.props?.testID === "icon:MaterialCommunityIcons:chevron-right"),
    ).toHaveLength(1);
    expect(pressables(tree)).toHaveLength(0);
  });

  it("ListRow forwards onLongPress and an entering animation onto the same node", () => {
    const onLongPress = vi.fn();
    const row = deepRender(
      <ListRow title="Task" onPress={() => {}} onLongPress={onLongPress} entering={enterRise} />,
    ) as any;
    // Under the mocks the animated interop host IS Pressable: no wrapper node.
    expect(row.type).toBe(Pressable);
    expect(row.props.entering).toBe(enterRise);
    expect(row.props.className).toContain("min-h-[52px]");
    row.props.onLongPress();
    expect(onLongPress).toHaveBeenCalledTimes(1);
    const inert = deepRender(<ListRow title="Task" entering={enterRise} />) as any;
    expect(inert.type).toBe(View);
    expect(inert.props.entering).toBe(enterRise);
    const plain = deepRender(<ListRow title="Task" />) as any;
    expect(plain.props.entering).toBeUndefined();
  });

  it("EmptyState size=compact is one 44px labelled row with an optional ghost action", () => {
    const onPress = vi.fn();
    const tree = deepRender(
      <EmptyState
        icon="check-circle-outline"
        title="Nothing overdue"
        body="All clear"
        size="compact"
        tone="success"
        action={{ label: "Add", onPress }}
      />,
    ) as any;
    expect(tree.props.className).toContain("min-h-[44px]");
    expect(tree.props.className).toContain("flex-row");
    expect(tree.props.accessible).toBe(true);
    expect(tree.props.accessibilityLabel).toBe("Nothing overdue. All clear");
    expect(text(tree)).toContain("Nothing overdue · All clear");
    const [action] = pressables(tree);
    expect(action.props.accessibilityLabel).toBe("Add");
    action.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
    const bare = deepRender(
      <EmptyState icon="inbox-outline" title="Inbox is clear" size="compact" />,
    ) as any;
    expect(bare.props.accessibilityLabel).toBe("Inbox is clear");
    expect(pressables(bare)).toHaveLength(0);
  });

  it("SectionHeader action.icon replaces the default chevron", () => {
    const withIcon = deepRender(
      <SectionHeader
        title="Reminders"
        action={{ label: "Add", onPress: () => {}, icon: "plus" }}
      />,
    );
    expect(
      findAll(withIcon, (n) => n.props?.testID === "icon:MaterialCommunityIcons:plus"),
    ).toHaveLength(1);
    expect(
      findAll(withIcon, (n) => n.props?.testID === "icon:MaterialCommunityIcons:chevron-right"),
    ).toHaveLength(0);
    const plain = deepRender(
      <SectionHeader title="Reminders" action={{ label: "All", onPress: () => {} }} />,
    );
    expect(
      findAll(plain, (n) => n.props?.testID === "icon:MaterialCommunityIcons:chevron-right"),
    ).toHaveLength(1);
  });

  it("MetricCard counts only plain integer strings, and speaks its delta", () => {
    expect(metricAnimatedValue("6,120")).toBe(6120);
    expect(metricAnimatedValue("8")).toBe(8);
    expect(metricAnimatedValue("-3")).toBe(-3);
    expect(metricAnimatedValue("1.27")).toBeNull();
    expect(metricAnimatedValue("12:30")).toBeNull();
    expect(metricAnimatedValue("1,27")).toBeNull();
    expect(metricAnimatedValue("")).toBeNull();
    expect(
      metricSpokenLabel({
        label: "Overdue",
        value: "2",
        delta: { label: "+1 today", tone: "danger" },
      }),
    ).toBe("Overdue 2, +1 today");
    const tree = deepRender(
      <MetricCard
        label="Overdue"
        value="2"
        delta={{ label: "+1 today", tone: "danger" }}
        animate
      />,
    ) as any;
    expect(tree.props.accessibilityLabel).toBe("Overdue 2, +1 today");
    expect(text(tree)).toContain("+1 today");
    const delta = findAll(tree, (n) => n.type === Text && text(n) === "+1 today")[0];
    expect(delta.props.className).toContain("text-danger");
    // On web the animated value is a plain Text of the same string; the
    // value never leaves the row as a different number.
    const values = findAll(tree, (n) => n.type === Text && text(n) === "2");
    expect(values).toHaveLength(1);
    expect(values[0].props.accessibilityLabel).toBe("2");
    const decimal = deepRender(<MetricCard label="Distance" value="1.27" unit="km" animate />);
    expect(text(decimal)).toContain("1.27");
  });

  it("useRefreshControl tints the control from the palette and is absent without onRefresh", () => {
    expect(useRefreshControl(false, undefined)).toBeUndefined();
    const onRefresh = vi.fn();
    const control = useRefreshControl(true, onRefresh) as any;
    expect(control.type).toBe(RefreshControl);
    expect(control.props.refreshing).toBe(true);
    expect(control.props.tintColor).toBe(LIGHT_COLORS.primary);
    expect(control.props.colors).toEqual([LIGHT_COLORS.primary]);
    expect(control.props.progressBackgroundColor).toBe(LIGHT_COLORS.surface);
    control.props.onRefresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
