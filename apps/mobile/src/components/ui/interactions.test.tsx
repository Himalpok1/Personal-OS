// Tests for the Checkpoint 10.6 motion and gesture primitives, in the same
// tree-walking idiom as primitives.test.tsx (no render library). Two
// additions to that idiom, both recorded in docs/MOBILE-DESIGN-SYSTEM.md:
//
//   - Under the reanimated mock every Reanimated hook is a plain function,
//     so a component that uses ONLY Reanimated hooks (PressableScale,
//     AnimatedNumber's outer branch, SwipeableRow) can still be invoked
//     directly.
//   - A component that also needs a React hook (a ref, an effect,
//     useSyncExternalStore) is a thin leaf listed in HOST_TYPES here, so the
//     walk stops at it and asserts on its props; its decisions live in pure
//     helpers pinned separately.
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  AnimatedNumber,
  AnimatedNumberCounter,
  animatedNumberLabel,
  formatGroupedInteger,
  numberTextStyle,
} from "./animated-number";
import { SheetFrame, SheetRow, sheetDurations, sheetTranslateY } from "./bottom-sheet";
import {
  CLAMPED_TEXT_DEFAULT_LINES,
  ClampedText,
  clampedTextClass,
  isOverLineBudget,
} from "./clamped-text";
import {
  CompletionCircle,
  CompletionGlyph,
  completionCircleIcon,
  completionCircleTone,
  completionHaptic,
} from "./completion-circle";
import {
  DURATION,
  PRESS_SCALE,
  SPRING,
  enterFade,
  enterRise,
  layoutSettle,
  motionEnabled,
} from "./motion";
import { PRESS_FALLBACK_CLASS, PressableScale, pressScaleConfig } from "./pressable-scale";
import {
  SwipeActionPanel,
  SwipeableRow,
  swipeActionPanelClass,
  swipeEnabled,
  type SwipeAction,
} from "./swipeable-row";
import { textClass } from "./text";
import { LIGHT_COLORS } from "./theme";
import {
  TOAST_DURATION_MS,
  TOAST_DURATION_WITH_ACTION_MS,
  ToastCard,
  dismissToast,
  getToast,
  resetToastStore,
  showToast,
  subscribeToast,
  toastClasses,
  toastDuration,
} from "./toast";

// The animated leaves: walked past as hosts, asserted on by their props.
const LEAF_TYPES = new Set<unknown>([CompletionGlyph, AnimatedNumberCounter]);
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, TextInput, ...LEAF_TYPES]);

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

/** Pretend to be a device for the length of `fn` (react-native-web reports "web"). */
function onAndroid<T>(fn: () => T): T {
  const platform = Platform as unknown as { OS: string };
  const previous = platform.OS;
  platform.OS = "android";
  try {
    return fn();
  } finally {
    platform.OS = previous;
  }
}

beforeEach(() => vi.clearAllMocks());

describe("motion vocabulary", () => {
  it("pins the durations, springs and press scale", () => {
    expect(DURATION).toEqual({ fast: 150, base: 220, slow: 320 });
    expect(SPRING.press).toEqual({ damping: 18, stiffness: 260 });
    expect(SPRING.settle.damping).toBeLessThan(SPRING.press.damping);
    expect(PRESS_SCALE).toBe(0.97);
    // The presets are built once at module load and must simply exist.
    expect(enterFade).toBeDefined();
    expect(enterRise).toBeDefined();
    expect(layoutSettle).toBeDefined();
  });

  it("motion never runs under reduced motion; rich motion is off on web, cheap motion stays on", () => {
    expect(motionEnabled({ reducedMotion: true, platformOS: "android", cost: "cheap" })).toBe(
      false,
    );
    expect(motionEnabled({ reducedMotion: true, platformOS: "android", cost: "rich" })).toBe(false);
    expect(motionEnabled({ reducedMotion: false, platformOS: "android", cost: "rich" })).toBe(true);
    expect(motionEnabled({ reducedMotion: false, platformOS: "ios", cost: "rich" })).toBe(true);
    expect(motionEnabled({ reducedMotion: false, platformOS: "web", cost: "rich" })).toBe(false);
    expect(motionEnabled({ reducedMotion: false, platformOS: "web", cost: "cheap" })).toBe(true);
  });
});

describe("PressableScale", () => {
  it("decides between the spring and the opacity fallback purely", () => {
    expect(pressScaleConfig(true)).toEqual({
      animated: true,
      pressedScale: 0.97,
      fallbackClass: "",
    });
    expect(pressScaleConfig(false)).toEqual({
      animated: false,
      pressedScale: 0.97,
      fallbackClass: PRESS_FALLBACK_CLASS,
    });
    // A caller whose classes already carry an active state opts out.
    expect(pressScaleConfig(false, null).fallbackClass).toBe("");
    expect(pressScaleConfig(false, "active:opacity-90").fallbackClass).toBe("active:opacity-90");
  });

  it("on web renders a plain Pressable with the fallback class and every prop intact", () => {
    const onPress = vi.fn();
    const tree = deepRender(
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open"
        className="flex-1 mt-2"
        testID="p"
      >
        <View />
      </PressableScale>,
    ) as any;
    expect(tree.type).toBe(Pressable);
    expect(tree.props.className).toBe(`flex-1 mt-2 ${PRESS_FALLBACK_CLASS}`);
    expect(tree.props.accessibilityLabel).toBe("Open");
    expect(tree.props.testID).toBe("p");
    tree.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("on a device drives the scale from press-in to press-out and keeps the caller's handlers", () => {
    onAndroid(() => {
      const onPressIn = vi.fn();
      const onPressOut = vi.fn();
      // Under the reanimated mock the animated host IS Pressable and
      // useAnimatedStyle is evaluated once, so the initial style is visible.
      const tree = deepRender(
        <PressableScale
          onPress={() => {}}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          className="p-4"
        >
          <View />
        </PressableScale>,
      ) as any;
      expect(tree.type).toBe(Pressable);
      // No opacity fallback in the animated branch; the class string is untouched.
      expect(tree.props.className).toBe("p-4");
      expect(tree.props.style).toEqual([undefined, { transform: [{ scale: 1 }] }]);
      tree.props.onPressIn({});
      tree.props.onPressOut({});
      expect(onPressIn).toHaveBeenCalledTimes(1);
      expect(onPressOut).toHaveBeenCalledTimes(1);
    });
  });
});

describe("CompletionCircle", () => {
  it("maps the three states to the two Today glyphs plus the filled check, by role", () => {
    expect(completionCircleIcon("open")).toBe("checkbox-blank-circle-outline");
    expect(completionCircleIcon("pending")).toBe("circle-slice-8");
    expect(completionCircleIcon("done")).toBe("check-circle");
    expect(completionCircleTone("open", "primary")).toBe("on-surface-variant");
    expect(completionCircleTone("pending", "primary")).toBe("primary");
    expect(completionCircleTone("done", "success")).toBe("success");
  });

  it("fires the success haptic only on the tap that completes", () => {
    expect(completionHaptic("open")).toBe("success");
    expect(completionHaptic("pending")).toBeNull();
    expect(completionHaptic("done")).toBeNull();
  });

  it("is a 44px labelled button that stops propagation and is inert while pending", () => {
    const onPress = vi.fn();
    const tree = deepRender(
      <CompletionCircle state="open" onPress={onPress} accessibilityLabel="Complete Homework" />,
    ) as any;
    expect(tree.type).toBe(Pressable);
    expect(tree.props.accessibilityRole).toBe("button");
    expect(tree.props.accessibilityLabel).toBe("Complete Homework");
    expect(tree.props.className).toContain("h-11 w-11");
    expect(tree.props.hitSlop).toBe(8);
    const event = { stopPropagation: vi.fn() };
    tree.props.onPress(event);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    const glyph = findAll(tree, (n) => n.type === CompletionGlyph)[0];
    expect(glyph.props).toEqual({ state: "open", tone: "primary", size: "md" });

    const pending = deepRender(
      <CompletionCircle state="pending" onPress={onPress} accessibilityLabel="Complete Homework" />,
    ) as any;
    expect(pending.props.disabled).toBe(true);
    expect(pending.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
      checked: false,
    });
    pending.props.onPress(event);
    expect(onPress).toHaveBeenCalledTimes(1);

    const done = deepRender(
      <CompletionCircle state="done" onPress={onPress} accessibilityLabel="Reopen Homework" />,
    ) as any;
    expect(done.props.accessibilityState.checked).toBe(true);
  });

  it("buzzes on the completing tap (on a device), and not on a reopen", () => {
    onAndroid(() => {
      const notify = vi.spyOn(Haptics, "notificationAsync");
      try {
        const open = deepRender(
          <CompletionCircle state="open" onPress={() => {}} accessibilityLabel="Complete" />,
        ) as any;
        open.props.onPress({ stopPropagation() {} });
        expect(notify).toHaveBeenCalledExactlyOnceWith(Haptics.NotificationFeedbackType.Success);
        const done = deepRender(
          <CompletionCircle state="done" onPress={() => {}} accessibilityLabel="Reopen" />,
        ) as any;
        done.props.onPress({ stopPropagation() {} });
        expect(notify).toHaveBeenCalledTimes(1);
      } finally {
        notify.mockRestore();
      }
    });
  });
});

describe("SwipeableRow", () => {
  const actions: SwipeAction[] = [
    {
      key: "done",
      label: "Done",
      icon: "check",
      tone: "success",
      onPress: vi.fn(),
      haptic: "success",
    },
    { key: "snooze", label: "Snooze", icon: "alarm-snooze", tone: "warning", onPress: vi.fn() },
  ];

  it("maps every tone to a container/label pair from the palette", () => {
    for (const tone of ["success", "warning", "danger", "primary", "neutral"] as const) {
      const c = swipeActionPanelClass(tone);
      expect(c.container).toContain("min-w-[76px]");
      expect(c.container).toMatch(/bg-[a-z-]+ dark:bg-[a-z-]+-dark/);
      expect(c.label).toMatch(/text-[a-z-]+ dark:text-[a-z-]+-dark/);
      expect(c.container).not.toMatch(/#|neutral-|white|black/);
    }
  });

  it("web gets no swipe: the children render alone", () => {
    expect(swipeEnabled("web")).toBe(false);
    expect(swipeEnabled("android")).toBe(true);
    const child = <View testID="row" />;
    const tree = deepRender(<SwipeableRow rightActions={actions}>{child}</SwipeableRow>);
    expect(findAll(tree, (n) => n.type === ReanimatedSwipeable)).toHaveLength(0);
    expect(findAll(tree, (n) => n.props?.testID === "row")).toHaveLength(1);
  });

  it("on a device wraps the children in the swipeable with a panel per side that has actions", () => {
    onAndroid(() => {
      const element = (
        <SwipeableRow rightActions={actions}>
          <View testID="row" />
        </SwipeableRow>
      );
      const rendered = (element.type as any)(element.props) as any;
      expect(rendered.type).toBe(ReanimatedSwipeable);
      expect(rendered.props.renderLeftActions).toBeUndefined();
      expect(typeof rendered.props.renderRightActions).toBe("function");
      // The panel closes the swipeable after an action fires.
      const close = vi.fn();
      const panel = deepRender(rendered.props.renderRightActions(null, null, { close }));
      const buttons = pressables(panel);
      expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(["Done", "Snooze"]);
      buttons[0].props.onPress();
      expect(actions[0]!.onPress).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      // No actions on either side: nothing to swipe, children alone.
      const bare = (element.type as any)({ children: <View testID="row" /> }) as any;
      expect(bare.type).not.toBe(ReanimatedSwipeable);
    });
  });

  it("an action's haptic fires with its press (on a device) and the panel is hookless", () => {
    onAndroid(() => {
      const notify = vi.spyOn(Haptics, "notificationAsync");
      try {
        const tree = deepRender(<SwipeActionPanel actions={actions} />);
        const [done, snooze] = pressables(tree);
        expect(done.props.accessibilityRole).toBe("button");
        expect(done.props.testID).toBe("swipe-action-done");
        expect(text(done)).toContain("Done");
        done.props.onPress();
        expect(notify).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
        snooze.props.onPress();
        expect(notify).toHaveBeenCalledTimes(1);
      } finally {
        notify.mockRestore();
      }
    });
  });
});

describe("Toast store and card", () => {
  beforeEach(() => {
    resetToastStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetToastStore();
  });

  it("defaults the duration by whether there is an action to reach", () => {
    expect(toastDuration({})).toBe(TOAST_DURATION_MS);
    expect(toastDuration({ action: { label: "Undo", onPress() {} } })).toBe(
      TOAST_DURATION_WITH_ACTION_MS,
    );
    expect(toastDuration({ durationMs: 1000, action: { label: "Undo", onPress() {} } })).toBe(1000);
  });

  it("shows one toast at a time (latest wins), notifies subscribers, and auto-dismisses", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToast(listener);
    const first = showToast({ message: "Archived" });
    expect(getToast()).toMatchObject({ id: first, message: "Archived", tone: "neutral" });
    expect(listener).toHaveBeenCalledTimes(1);
    const second = showToast({ message: "Completed", tone: "success" });
    expect(second).not.toBe(first);
    expect(getToast()?.message).toBe("Completed");
    // Dismissing by a stale id is a no-op; the first toast's timer was dropped.
    dismissToast(first);
    expect(getToast()?.id).toBe(second);
    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(getToast()?.id).toBe(second);
    vi.advanceTimersByTime(1);
    expect(getToast()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    showToast({ message: "Quiet" });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("maps every tone to a container/text pair from the palette", () => {
    for (const tone of ["neutral", "success", "warning", "danger", "info"] as const) {
      const c = toastClasses(tone);
      expect(c.container).toContain("rounded-inner");
      expect(c.container).toMatch(/bg-[a-z-]+ dark:bg-[a-z-]+-dark/);
      expect(c.text).toMatch(/text-[a-z-]+ dark:text-[a-z-]+-dark/);
      expect(c.container).not.toMatch(/#|neutral-|white|black/);
    }
  });

  it("ToastCard is a polite live region with a 44px action that also dismisses", () => {
    const onPress = vi.fn();
    const onDismiss = vi.fn();
    const toast = {
      id: 1,
      message: "Task archived",
      tone: "neutral" as const,
      action: { label: "Undo", onPress },
      durationMs: 6000,
    };
    const tree = deepRender(<ToastCard toast={toast} onDismiss={onDismiss} />) as any;
    expect(tree.props.accessibilityLiveRegion).toBe("polite");
    expect(text(tree)).toContain("Task archived");
    const [action] = pressables(tree);
    expect(action.props.accessibilityRole).toBe("button");
    expect(action.props.accessibilityLabel).toBe("Undo");
    expect(action.props.className).toContain("min-h-[44px]");
    action.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const plain = deepRender(
      <ToastCard toast={{ ...toast, action: undefined }} onDismiss={onDismiss} />,
    );
    expect(pressables(plain)).toHaveLength(0);
  });
});

describe("AnimatedNumber", () => {
  it("groups thousands without Intl and never renders a non-finite value", () => {
    expect(formatGroupedInteger(0)).toBe("0");
    expect(formatGroupedInteger(999)).toBe("999");
    expect(formatGroupedInteger(1000)).toBe("1,000");
    expect(formatGroupedInteger(1234567.6)).toBe("1,234,568");
    expect(formatGroupedInteger(-1234)).toBe("-1,234");
    expect(formatGroupedInteger(Number.NaN)).toBe("0");
    expect(animatedNumberLabel(6120)).toBe("6,120");
    expect(animatedNumberLabel(2, (n) => `${n} tasks`)).toBe("2 tasks");
  });

  it("resolves the type style from the same tokens AppText compiles from", () => {
    const style = numberTextStyle("headline", "danger", LIGHT_COLORS);
    expect(style).toMatchObject({
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      color: LIGHT_COLORS.danger,
    });
    expect(numberTextStyle("body-strong", "default", LIGHT_COLORS).fontSize).toBe(15);
    expect(numberTextStyle("display", "on-gradient", LIGHT_COLORS).color).toBe("#FFFFFF");
  });

  it("on web (and under reduced motion) is a plain text node whose label is the final value", () => {
    const tree = deepRender(
      <AnimatedNumber value={6120} variant="headline" tone="primary" />,
    ) as any;
    expect(tree.type).toBe(Text);
    expect(tree.props.accessibilityRole).toBe("text");
    expect(tree.props.accessibilityLabel).toBe("6,120");
    expect(tree.props.className).toBe(textClass("headline", "primary"));
    expect(text(tree)).toBe("6,120");
  });

  it("on a device hands the counter leaf the final label and the format", () => {
    onAndroid(() => {
      const tree = deepRender(<AnimatedNumber value={42} />) as any;
      expect(tree.type).toBe(AnimatedNumberCounter);
      expect(tree.props.accessibilityLabel).toBe("42");
      expect(tree.props.value).toBe(42);
      expect(tree.props.format(1000)).toBe("1,000");
    });
  });
});

describe("ClampedText", () => {
  function makeInstance(
    text: string,
    props?: Partial<ConstructorParameters<typeof ClampedText>[0]>,
    initialState?: Partial<{ expanded: boolean; isClamped: boolean }>,
  ): ClampedText {
    const instance = new ClampedText({ text, ...props });
    if (initialState) Object.assign(instance.state, initialState);
    return instance;
  }
  function fakeLayoutEvent(lineCount: number): any {
    return { nativeEvent: { lines: Array.from({ length: lineCount }, () => ({})) } };
  }
  const visibleTextNode = (tree: unknown) =>
    findAll(tree, (n) => n.type === Text && n.props?.onTextLayout === undefined)[0];
  const measureTextNode = (tree: unknown) =>
    findAll(tree, (n) => n.type === Text && n.props?.onTextLayout !== undefined)[0];

  it("resolves the prose class from the vocabulary, or takes the originals' raw class", () => {
    expect(clampedTextClass({})).toBe(textClass("body", "secondary"));
    expect(clampedTextClass({ variant: "label", tone: "muted" })).toBe(textClass("label", "muted"));
    expect(clampedTextClass({ textClassName: "text-sm", variant: "label" })).toBe("text-sm");
    expect(isOverLineBudget(6, 6)).toBe(false);
    expect(isOverLineBudget(7, 6)).toBe(true);
  });

  it("shows no toggle before a real measurement, and clamps to the budget", () => {
    const instance = makeInstance("A short brief.");
    const tree = deepRender(instance.render());
    expect(pressables(tree)).toHaveLength(0);
    expect(visibleTextNode(tree).props.numberOfLines).toBe(CLAMPED_TEXT_DEFAULT_LINES);
    // The hidden measurement copy is unclamped, invisible and inert.
    const measure = measureTextNode(tree);
    expect(measure.props.numberOfLines).toBeUndefined();
    expect(measure.props.accessible).toBe(false);
    expect(measure.props.style).toMatchObject({ position: "absolute", opacity: 0 });
    expect(text(measure)).toBe("A short brief.");
  });

  it("decides clamped-ness from the measured line count against `lines`", () => {
    const instance = makeInstance("Long.", { lines: 3 });
    const spy = vi.spyOn(instance, "setState");
    instance.handleMeasureLayout(fakeLayoutEvent(3));
    expect(spy).not.toHaveBeenCalled();
    instance.handleMeasureLayout(fakeLayoutEvent(4));
    expect(spy).toHaveBeenCalledExactlyOnceWith({ isClamped: true });
  });

  it("renders the toggle with its expanded state and custom labels, and resets on a text change", () => {
    const instance = makeInstance(
      "Long.",
      { moreLabel: "Read on", lessLabel: "Fold", testID: "digest" },
      { isClamped: true },
    );
    const collapsed = deepRender(instance.render());
    const [toggle] = pressables(collapsed);
    expect(toggle.props.accessibilityRole).toBe("button");
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    expect(toggle.props.className).toContain("min-h-[44px]");
    expect(toggle.props.testID).toBe("digest-toggle");
    expect(text(toggle)).toBe("Read on");
    const expanded = makeInstance(
      "Long.",
      { lessLabel: "Fold" },
      { isClamped: true, expanded: true },
    );
    const tree = deepRender(expanded.render());
    expect(visibleTextNode(tree).props.numberOfLines).toBeUndefined();
    expect(text(pressables(tree)[0])).toBe("Fold");
    const spy = vi.spyOn(expanded, "setState");
    expanded.componentDidUpdate({ text: "Other." });
    expect(spy).toHaveBeenCalledExactlyOnceWith({ expanded: false, isClamped: false });
    expanded.componentDidUpdate({ text: "Long." });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("BottomSheet frame and rows", () => {
  it("slides from the measured height and takes no time under reduced motion", () => {
    expect(sheetTranslateY(0, 400)).toBe(400);
    expect(sheetTranslateY(1, 400)).toBe(0);
    expect(sheetTranslateY(0.5, 400)).toBe(200);
    expect(sheetDurations(true)).toEqual({ open: DURATION.slow, close: DURATION.base });
    expect(sheetDurations(false)).toEqual({ open: 0, close: 0 });
  });

  it("SheetFrame is modal to assistive tech, carries a handle, a header title and a Close button", () => {
    const onClose = vi.fn();
    const tree = deepRender(
      <SheetFrame title="Snooze" onClose={onClose} bottomInset={20} testID="sheet">
        <View testID="content" />
      </SheetFrame>,
    ) as any;
    expect(tree.props.accessibilityViewIsModal).toBe(true);
    expect(tree.props.style).toEqual({ paddingBottom: 36 });
    expect(tree.props.className).toContain("rounded-t-card");
    const header = findAll(tree, (n) => n.props?.accessibilityRole === "header")[0];
    expect(text(header)).toBe("Snooze");
    const [close] = pressables(tree);
    expect(close.props.accessibilityLabel).toBe("Close");
    close.props.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(findAll(tree, (n) => n.props?.testID === "content")).toHaveLength(1);
    const bare = deepRender(
      <SheetFrame onClose={onClose} hideClose>
        <View />
      </SheetFrame>,
    );
    expect(pressables(bare)).toHaveLength(0);
  });

  it("SheetRow is a labelled 52px button and reads danger in the danger tone", () => {
    const onPress = vi.fn();
    const row = deepRender(
      <SheetRow
        icon="archive-arrow-down-outline"
        label="Archive"
        tone="danger"
        onPress={onPress}
        last
      />,
    ) as any;
    expect(row.type).toBe(Pressable);
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe("Archive");
    expect(row.props.className).toContain("min-h-[52px]");
    expect(row.props.className).not.toContain("border-b");
    const title = findAll(row, (n) => n.type === Text && text(n) === "Archive")[0];
    expect(title.props.className).toContain("text-danger");
    row.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
