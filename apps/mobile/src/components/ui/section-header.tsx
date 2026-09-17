// A section heading (Checkpoint 10.3): overline title, optional count,
// optional trailing action -- the same row on Today, Academics, Health and
// every detail screen, so sections read as one system.
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { AppText, type TextTone } from "./text";

export type SectionTone = "default" | "danger" | "warning" | "success" | "info" | "primary";

const TITLE_TONE: Record<SectionTone, TextTone> = {
  default: "secondary",
  danger: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  primary: "primary",
};

export interface SectionHeaderProps {
  title: string;
  /** Rendered after the title as `· N`. Zero renders `· 0` (an honest empty section). */
  count?: number;
  tone?: SectionTone;
  icon?: IconName;
  /** A trailing text action, e.g. "See all". */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** Any trailing element instead of a text action. */
  trailing?: ReactNode;
  /** Vertical rhythm: `page` sits between sections on a screen; `card` sits inside a card. */
  spacing?: "page" | "card" | "none";
  className?: string;
}

const SPACING_CLASS = { page: "pb-2 pt-6", card: "pb-2", none: "" } as const;

export function sectionTitleText(title: string, count?: number): string {
  return count === undefined ? title : `${title} · ${count}`;
}

export function SectionHeader({
  title,
  count,
  tone = "default",
  icon,
  action,
  trailing,
  spacing = "page",
  className,
}: SectionHeaderProps) {
  return (
    <View
      className={["flex-row items-center justify-between gap-3", SPACING_CLASS[spacing], className]
        .filter(Boolean)
        .join(" ")}
    >
      <View className="flex-1 flex-row items-center gap-1.5">
        {icon ? (
          <Icon name={icon} size="sm" tone={tone === "default" ? "on-surface-variant" : tone} />
        ) : null}
        {/* The heading role sits on the title Text, not the row: on web the
            row would become an <h1> whose name included the action and which
            contained a <button>. */}
        <AppText
          variant="overline"
          tone={TITLE_TONE[tone]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {sectionTitleText(title, count)}
        </AppText>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          className="min-h-[44px] flex-row items-center gap-0.5 active:opacity-70"
        >
          <AppText variant="label" tone="primary">
            {action.label}
          </AppText>
          <Icon name="chevron-right" size="sm" tone="primary" />
        </Pressable>
      ) : (
        (trailing ?? null)
      )}
    </View>
  );
}
