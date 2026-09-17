// A selectable chip (Checkpoint 10.3): a small tonal Button when selected, an
// outline one otherwise -- the design system's "chips are information,
// buttons are affordances" rule read literally, so a tappable filter never
// looks like a StatusChip. Composed here rather than in components/ui/
// because `Button` carries no `selected` accessibility state, and every
// picker in this app has exposed one since the 6.7A accessibility pass (the
// ask preset chips and the agenda's project filter are the two consumers).
//
// The classes come from `buttonClasses`, the design system's own pure
// helper, so a chip is a small Button in every way but the extra state.
import { Pressable } from "react-native";
import { AppText, buttonClasses } from "@/components/ui";

export interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Omitted means "not disabled" AND no `disabled` key in the accessibility state. */
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function ChoiceChip({
  label,
  selected,
  onPress,
  disabled,
  accessibilityLabel,
  testID,
}: ChoiceChipProps) {
  const classes = buttonClasses(selected ? "tonal" : "outline", "sm", false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={disabled === undefined ? { selected } : { selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      className={[classes.container, disabled ? "opacity-60" : ""].filter(Boolean).join(" ")}
    >
      <AppText
        variant="label"
        tone="inherit"
        className={`${classes.label} font-semibold`}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
