// Clamped prose with a Show more / Show less toggle (Checkpoint 10.6).
//
// The one component behind the Daily Brief's `ClampedBriefText` and the mail
// digest's `ClampedDigestText`, both written in Checkpoint 5.6 / 7.6 as
// identical class components: model prose is unbounded, and a long paragraph
// would push every row below the fold on the Rabbit R1's 640px screen, so it
// collapses to `lines` and only offers a toggle when it actually overflows.
//
// A CLASS COMPONENT, deliberately, for the reason those two were: the
// tree-walking test harness calls components directly with no React
// dispatcher, which cannot support hooks, but a class instance's state needs
// none -- so it can be constructed and inspected in a test exactly like the
// originals (brief-card.test.tsx documents the two techniques).
//
// The hidden measurement Text is load-bearing, not decoration: `onTextLayout`
// on a Text that ALREADY has `numberOfLines` reports the TRUNCATED line
// count, so measuring the visible clamped copy would report exactly the
// limit forever and the toggle would never appear. Guessing from string
// length is also wrong (font, width and locale all affect wrapping), which
// is why `isClamped` starts false and nothing renders until a real
// measurement returns.
//
// Checkpoint 10.6 adds the expand transition: the prose sits in an animated
// View whose `layout` preset eases the height change instead of snapping.
// `Animated.View` takes no className, so the caller's container class stays
// on the plain outer View.
import { Component, type ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { layoutSettle } from "./motion";
import { AppText, textClass, type TextTone, type TextVariant } from "./text";

type TextLayoutEvent = Parameters<NonNullable<ComponentProps<typeof Text>["onTextLayout"]>>[0];

export const CLAMPED_TEXT_DEFAULT_LINES = 6;

export interface ClampedTextProps {
  text: string;
  /** Collapsed line budget. Text that fits exactly is not clamped. */
  lines?: number;
  moreLabel?: string;
  lessLabel?: string;
  /** The prose style by vocabulary; ignored when `textClassName` is given. */
  variant?: TextVariant;
  tone?: TextTone;
  /**
   * Raw classes for the prose (the originals' prop, kept so `ClampedBriefText`
   * and `ClampedDigestText` can be replaced without restyling their cards).
   */
  textClassName?: string;
  containerClassName?: string;
  testID?: string;
}

export interface ClampedTextState {
  expanded: boolean;
  /** True only once a real measurement has confirmed the text needs more than `lines`. */
  isClamped: boolean;
}

/** Pure: the prose class for the given props. */
export function clampedTextClass(
  props: Pick<ClampedTextProps, "variant" | "tone" | "textClassName">,
) {
  return props.textClassName ?? textClass(props.variant ?? "body", props.tone ?? "secondary");
}

/** Pure: is a measured line count over the budget? Exactly at the budget is not. */
export function isOverLineBudget(measuredLines: number, lines: number): boolean {
  return measuredLines > lines;
}

export class ClampedText extends Component<ClampedTextProps, ClampedTextState> {
  state: ClampedTextState = { expanded: false, isClamped: false };

  componentDidUpdate(prevProps: ClampedTextProps): void {
    // A regenerate (or any text change) must not leave a stale expanded or
    // measured view of the previous text hanging around.
    if (prevProps.text !== this.props.text) {
      this.setState({ expanded: false, isClamped: false });
    }
  }

  handleMeasureLayout = (event: TextLayoutEvent): void => {
    const isClamped = isOverLineBudget(
      event.nativeEvent.lines.length,
      this.props.lines ?? CLAMPED_TEXT_DEFAULT_LINES,
    );
    if (isClamped !== this.state.isClamped) this.setState({ isClamped });
  };

  toggleExpanded = (): void => {
    this.setState((prev) => ({ expanded: !prev.expanded }));
  };

  render() {
    const {
      text,
      lines = CLAMPED_TEXT_DEFAULT_LINES,
      moreLabel = "Show more",
      lessLabel = "Show less",
      containerClassName,
      testID,
    } = this.props;
    const { expanded, isClamped } = this.state;
    const prose = clampedTextClass(this.props);

    return (
      <View className={containerClassName} testID={testID}>
        <Text
          className={prose}
          style={{ position: "absolute", opacity: 0, zIndex: -1 }}
          onTextLayout={this.handleMeasureLayout}
          accessible={false}
          pointerEvents="none"
        >
          {text}
        </Text>
        <Animated.View layout={layoutSettle}>
          <Text className={prose} numberOfLines={expanded ? undefined : lines}>
            {text}
          </Text>
        </Animated.View>
        {isClamped ? (
          <Pressable
            onPress={this.toggleExpanded}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={8}
            className="mt-1 min-h-[44px] items-center justify-start"
            testID={testID ? `${testID}-toggle` : undefined}
          >
            <AppText variant="label" tone="primary">
              {expanded ? lessLabel : moreLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }
}
