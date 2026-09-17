// The one icon component (Checkpoint 10.3).
//
// Material Community Icons through @expo/vector-icons: one font family, so
// only one icon font is bundled, and a name that exists on Android, iOS and
// web alike (expo-symbols, already a dependency, renders SF Symbols on iOS
// only -- useless on the Rabbit R1, this app's daily driver). `name` is typed
// against the glyph map so a typo fails typecheck instead of drawing a box.
//
// Colour comes from the palette by ROLE, never a hex: pass `tone` and the
// icon follows the scheme like every class-styled element around it.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useTheme, type ColorRole } from "./theme";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<IconSize, number> = { xs: 14, sm: 16, md: 20, lg: 24, xl: 32 };

export interface IconProps {
  name: IconName;
  size?: IconSize | number;
  /** A palette role; defaults to the secondary text colour. */
  tone?: ColorRole;
  /** A raw colour, for the rare case the icon sits on a gradient. Wins over `tone`. */
  color?: string;
  accessibilityLabel?: string;
  style?: ComponentProps<typeof MaterialCommunityIcons>["style"];
}

export function iconSizePx(size: IconSize | number | undefined): number {
  if (size === undefined) return SIZE_PX.md;
  return typeof size === "number" ? size : SIZE_PX[size];
}

export function Icon({
  name,
  size,
  tone = "on-surface-variant",
  color,
  accessibilityLabel,
  style,
}: IconProps) {
  const { colors } = useTheme();
  return (
    <MaterialCommunityIcons
      name={name}
      size={iconSizePx(size)}
      color={color ?? colors[tone]}
      accessibilityLabel={accessibilityLabel}
      // Decorative unless a label is given: screen readers skip it and read
      // the row's own label instead of "icon". `aria-hidden` is the prop
      // react-native-web actually forwards; the two RN props cover native.
      aria-hidden={accessibilityLabel === undefined}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={accessibilityLabel === undefined ? "no" : "yes"}
      style={style}
    />
  );
}
