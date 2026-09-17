// Screen scaffolding (Checkpoint 10.3).
//
// `Screen` is the scroll container every read-mostly screen uses: the canvas
// background, the 16px gutter, the floating-button clearance from
// floating-layout.ts, and pull-to-refresh wired to a query's `refetch`. A
// screen that manages its own list (a FlatList tab) uses `ScreenFrame` for
// just the background and lets the list own scrolling.
//
// `ScreenHeader` is the in-flow title block -- display title, optional
// subtitle, optional trailing actions -- used INSTEAD of a navigator header
// on the tabs and on the screens that want a hero above their content.
//
// `useRefreshControl` (Checkpoint 10.6) is the palette-tinted RefreshControl
// `Screen` wires for itself, exposed so a FlatList tab hands the same element
// to its list's `refreshControl` instead of restating the four colour props.
import type { ReactElement, ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FLOATING_CLEARANCE } from "../floating-layout";
import { AppText } from "./text";
import { useTheme } from "./theme";

const CANVAS_CLASS = "flex-1 bg-canvas dark:bg-canvas-dark";

export interface ScreenProps extends Omit<
  ScrollViewProps,
  "className" | "contentContainerClassName"
> {
  children: ReactNode;
  /** Wire to a query's `isRefetching`/`refetch` pair for pull-to-refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Gutter on by default; a screen with its own edge-to-edge list turns it off. */
  gutter?: boolean;
  /**
   * Pad the top by the status-bar inset. Only for a screen that hides its
   * navigator bar (Today): every other screen sits under a bar that already
   * clears the inset, and padding it twice would open a gap.
   */
  safeTop?: boolean;
  /** Extra content-container classes (padding tweaks). */
  contentClassName?: string;
  testID?: string;
}

/**
 * A RefreshControl tinted from the palette, or undefined when there is no
 * `onRefresh` (so a list without one gets no pull-to-refresh at all).
 */
export function useRefreshControl(
  refreshing: boolean,
  onRefresh: (() => void) | undefined,
): ReactElement<RefreshControlProps> | undefined {
  const { colors } = useTheme();
  if (!onRefresh) return undefined;
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
      progressBackgroundColor={colors.surface}
    />
  );
}

export function Screen({
  children,
  refreshing = false,
  onRefresh,
  gutter = true,
  safeTop = false,
  contentClassName,
  testID,
  ...rest
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const refreshControl = useRefreshControl(refreshing, onRefresh);
  return (
    <ScrollView
      {...rest}
      className={CANVAS_CLASS}
      contentContainerClassName={[FLOATING_CLEARANCE, gutter ? "px-4" : "", contentClassName]
        .filter(Boolean)
        .join(" ")}
      // Merged with the class above rather than replacing it: NativeWind maps
      // contentContainerClassName onto contentContainerStyle, so a style here
      // must only ADD a key the class does not set (floating-layout.ts).
      contentContainerStyle={safeTop ? { paddingTop: insets.top } : undefined}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

/** The canvas background alone, for a screen whose list owns scrolling. */
export function ScreenFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={[CANVAS_CLASS, className].filter(Boolean).join(" ")}>{children}</View>;
}

/** A centred full-height frame for a loading / error / empty screen state. */
export function ScreenCentered({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View className={`${CANVAS_CLASS} items-center justify-center px-6`} testID={testID}>
      {children}
    </View>
  );
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** A small line above the title (a date, a term name). */
  eyebrow?: string;
  /** Trailing actions, laid out in a row. */
  actions?: ReactNode;
  /**
   * `display` (default) draws the title large -- for a tab that hides its
   * navigator bar, where this block IS the title. `compact` draws only the
   * eyebrow and subtitle -- for a stack screen, whose navigator bar already
   * shows the title and whose 640px of height should not spend 40 of them
   * repeating it. The title is still spoken as the block's label.
   */
  variant?: "display" | "compact";
  className?: string;
}

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  variant = "display",
  className,
}: ScreenHeaderProps) {
  const compact = variant === "compact";
  return (
    <View
      className={["flex-row items-end justify-between gap-3", compact ? "pt-3" : "pt-4", className]
        .filter(Boolean)
        .join(" ")}
      accessibilityLabel={compact ? title : undefined}
    >
      <View className="flex-1">
        {eyebrow ? (
          <AppText variant="overline" tone="muted" numberOfLines={1}>
            {eyebrow}
          </AppText>
        ) : null}
        {compact ? null : (
          <AppText variant="display" numberOfLines={2} accessibilityRole="header">
            {title}
          </AppText>
        )}
        {subtitle ? (
          <AppText variant="body" tone="secondary" numberOfLines={2} className="mt-0.5">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actions ? <View className="flex-row items-center gap-1">{actions}</View> : null}
    </View>
  );
}
