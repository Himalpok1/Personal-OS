// An empty state (Checkpoint 10.3): an icon in a soft tinted disc, a short
// title, one sentence, and at most one action. The same shape whether it is
// a whole screen ("No courses have synced yet") or one section ("Nothing
// overdue") -- `size` only changes the scale.
import { View } from "react-native";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { AppText } from "./text";

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
  /** `screen` centres in the available height; `section` is an inline block. */
  size?: "screen" | "section";
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
        <Button
          label={action.label}
          onPress={action.onPress}
          accessibilityLabel={action.accessibilityLabel}
          variant="tonal"
          className="mt-4"
        />
      ) : null}
    </View>
  );
}
