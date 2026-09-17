// An empty state (Checkpoint 10.3): an icon in a soft tinted disc, a short
// title, one sentence, and at most one action. The same shape whether it is
// a whole screen ("No courses have synced yet") or one section ("Nothing
// overdue") -- `size` only changes the scale. Checkpoint 10.6 adds
// `compact`: one line, icon beside the title, for the empty state INSIDE a
// card where a stacked block would be taller than the rows it stands in for.
import { View } from "react-native";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { AppText } from "./text";

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** `screen` centres in the available height; `section` is an inline block; `compact` is one row. */
  size?: "screen" | "section" | "compact";
  tone?: "neutral" | "success";
  className?: string;
  testID?: string;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  size = "section",
  tone = "neutral",
  className,
  testID,
}: EmptyStateProps) {
  const disc =
    tone === "success"
      ? "bg-success-container dark:bg-success-container-dark"
      : "bg-primary-container dark:bg-primary-container-dark";
  const iconTone = tone === "success" ? "on-success-container" : "on-primary-container";
  if (size === "compact") {
    return (
      <View
        className={["min-h-[44px] flex-row items-center gap-3 px-4 py-2", className]
          .filter(Boolean)
          .join(" ")}
        accessible
        accessibilityLabel={body ? `${title}. ${body}` : title}
        testID={testID}
      >
        <View className={`h-8 w-8 items-center justify-center rounded-full ${disc}`}>
          <Icon name={icon} size="sm" tone={iconTone} />
        </View>
        <AppText variant="label" tone="secondary" numberOfLines={1} className="flex-1 font-normal">
          {body ? `${title} · ${body}` : title}
        </AppText>
        {action ? (
          <Button
            label={action.label}
            onPress={action.onPress}
            accessibilityLabel={action.accessibilityLabel}
            variant="ghost"
            size="sm"
          />
        ) : null}
      </View>
    );
  }
  return (
    <View
      className={[
        "items-center px-6",
        size === "screen" ? "flex-1 justify-center py-12" : "py-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      testID={testID}
    >
      <View
        className={`items-center justify-center rounded-full ${disc} ${
          size === "screen" ? "h-16 w-16" : "h-12 w-12"
        }`}
      >
        <Icon name={icon} size={size === "screen" ? "xl" : "lg"} tone={iconTone} />
      </View>
      <AppText variant={size === "screen" ? "title" : "body-strong"} className="mt-3 text-center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" tone="secondary" className="mt-1 max-w-[320px] text-center">
          {body}
        </AppText>
      ) : null}
      {action ? (
        // Wrapped for the same reason as ErrorState's retry: `Button` is
        // `self-start`, which would left-align it inside this centred column.
        <View className="mt-4">
          <Button
            label={action.label}
            onPress={action.onPress}
            accessibilityLabel={action.accessibilityLabel}
            variant="tonal"
          />
        </View>
      ) : null}
    </View>
  );
}
