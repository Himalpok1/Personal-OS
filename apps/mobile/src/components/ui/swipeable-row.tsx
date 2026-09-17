// A row with swipe actions (Checkpoint 10.6).
//
// Wraps react-native-gesture-handler's `ReanimatedSwipeable`: drag the row
// left or right to reveal a panel of toned actions (complete, snooze,
// archive) drawn from the container tokens. The gesture is user-driven, so
// it works under reduced motion -- the panel simply follows the finger.
//
// WEB GETS NO SWIPE. `Platform.OS === "web"` renders the children alone: a
// mouse drag is not a swipe, and every action a panel offers must ALSO be
// reachable through the row's own controls (its completion circle, its
// detail screen, its long-press sheet). A swipe is a shortcut, never the
// only route -- which is also what keeps it honest for a screen-reader user
// on a device, who reaches the same actions the same other way.
//
// Each action closes the panel after it fires and, if it says so, fires a
// haptic. `swipeActionPanelClass` is the pure tone vocabulary; `SwipeActionPanel`
// is hookless so the tree-walking tests can render it.
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { triggerHaptic } from "./haptics";
import { Icon, type IconName } from "./icon";
import { AppText } from "./text";
import type { ColorRole } from "./theme";

export type SwipeTone = "success" | "warning" | "danger" | "primary" | "neutral";

export interface SwipeAction {
  key: string;
  label: string;
  icon: IconName;
  tone: SwipeTone;
  onPress: () => void;
  haptic?: "light" | "success" | "warning";
}

const PANEL_CLASS: Record<SwipeTone, string> = {
  success: "bg-success-container dark:bg-success-container-dark",
  warning: "bg-warning-container dark:bg-warning-container-dark",
  danger: "bg-danger-container dark:bg-danger-container-dark",
  primary: "bg-primary-container dark:bg-primary-container-dark",
  neutral: "bg-surface-container dark:bg-surface-container-dark",
};

const LABEL_CLASS: Record<SwipeTone, string> = {
  success: "text-on-success-container dark:text-on-success-container-dark",
  warning: "text-on-warning-container dark:text-on-warning-container-dark",
  danger: "text-on-danger-container dark:text-on-danger-container-dark",
  primary: "text-on-primary-container dark:text-on-primary-container-dark",
  neutral: "text-on-surface-variant dark:text-on-surface-variant-dark",
};

const ICON_ROLE: Record<SwipeTone, ColorRole> = {
  success: "on-success-container",
  warning: "on-warning-container",
  danger: "on-danger-container",
  primary: "on-primary-container",
  neutral: "on-surface-variant",
};

/** Pure helper so the tone vocabulary can be pinned without rendering. */
export function swipeActionPanelClass(tone: SwipeTone): { container: string; label: string } {
  return {
    container: `min-w-[76px] items-center justify-center gap-1 px-3 ${PANEL_CLASS[tone]}`,
    label: LABEL_CLASS[tone],
  };
}

/** Pure: does a swipe render on this platform? */
export function swipeEnabled(platformOS: string): boolean {
  return platformOS !== "web";
}

export interface SwipeableRowProps {
  children: ReactNode;
  /** Revealed by dragging the row to the right. */
  leftActions?: SwipeAction[];
  /** Revealed by dragging the row to the left. */
  rightActions?: SwipeAction[];
  testID?: string;
}

/** One side's panel: a row of full-height toned buttons. Hookless. */
export function SwipeActionPanel({
  actions,
  onActionPressed,
}: {
  actions: readonly SwipeAction[];
  /** Called after an action's own `onPress`; the swipeable closes itself here. */
  onActionPressed?: () => void;
}) {
  return (
    <View className="flex-row">
      {actions.map((action) => {
        const classes = swipeActionPanelClass(action.tone);
        return (
          <Pressable
            key={action.key}
            onPress={() => {
              if (action.haptic) triggerHaptic(action.haptic);
              action.onPress();
              onActionPressed?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            className={`${classes.container} active:opacity-80`}
            testID={`swipe-action-${action.key}`}
          >
            <Icon name={action.icon} size="md" tone={ICON_ROLE[action.tone]} />
            <AppText
              variant="caption"
              tone="inherit"
              className={`${classes.label} font-semibold`}
              numberOfLines={1}
            >
              {action.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwipeableRow({ children, leftActions, rightActions, testID }: SwipeableRowProps) {
  const hasLeft = leftActions !== undefined && leftActions.length > 0;
  const hasRight = rightActions !== undefined && rightActions.length > 0;
  if (!swipeEnabled(Platform.OS) || (!hasLeft && !hasRight)) {
    return <>{children}</>;
  }
  return (
    <ReanimatedSwipeable
      friction={2}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={40}
      rightThreshold={40}
      renderLeftActions={
        hasLeft
          ? (_progress, _translation, methods: SwipeableMethods) => (
              <SwipeActionPanel actions={leftActions} onActionPressed={methods.close} />
            )
          : undefined
      }
      renderRightActions={
        hasRight
          ? (_progress, _translation, methods: SwipeableMethods) => (
              <SwipeActionPanel actions={rightActions} onActionPressed={methods.close} />
            )
          : undefined
      }
      testID={testID}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
