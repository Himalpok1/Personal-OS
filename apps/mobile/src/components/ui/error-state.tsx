// A load failure (Checkpoint 10.3): what went wrong in one line, and a Retry.
// Deliberately never falls through to an empty state -- when the API is
// unreachable we know nothing about the data, and "nothing here" would be a
// lie (the rule health/index.tsx and academic/index.tsx both record).
import { View } from "react-native";
import { Button } from "./button";
import { Icon } from "./icon";
import { AppText } from "./text";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retryAccessibilityLabel?: string;
  size?: "screen" | "section";
  className?: string;
  testID?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
  retryAccessibilityLabel,
  size = "section",
  className,
  testID,
}: ErrorStateProps) {
  return (
    <View
      className={[
        "items-center px-6",
        size === "screen" ? "flex-1 justify-center py-12" : "py-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      accessibilityRole="alert"
      testID={testID}
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-danger-container dark:bg-danger-container-dark">
        <Icon name="alert-circle-outline" size="lg" tone="on-danger-container" />
      </View>
      <AppText variant="title" className="mt-3 text-center">
        {title}
      </AppText>
      <AppText variant="body" tone="secondary" className="mt-1 max-w-[320px] text-center">
        {message}
      </AppText>
      {onRetry ? (
        // Wrapped so the button centres under the copy: `Button` sets
        // `self-start` unless `block`, which would pin it to the left edge of
        // this `items-center` column (visible on web at HEAD before 10.6).
        <View className="mt-4">
          <Button
            label={retryLabel}
            onPress={onRetry}
            accessibilityLabel={retryAccessibilityLabel ?? retryLabel}
            variant="primary"
          />
        </View>
      ) : null}
    </View>
  );
}
