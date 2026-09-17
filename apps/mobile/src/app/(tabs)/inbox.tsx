import type { InboxItem } from "@personal-os/schema";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { canConfirmInboxItem, confirmErrorMessage } from "@/components/inbox/confirm-state";
import { parseSummaryHeadline } from "@/components/inbox/parse-summary";
import { inboxStatusPresentation } from "@/components/inbox/status-presentation";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ScreenFrame,
  SkeletonList,
  StatusChip,
  useTheme,
  type ChipTone,
  type ColorRole,
} from "@/components/ui";
import { useConfirmInboxItem, useInbox } from "@/queries/inbox";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

// The leading icon is tinted by the status's chip tone, through the palette
// role the Icon primitive reads -- never a colour class of this screen's own.
const ICON_ROLE: Record<ChipTone, ColorRole> = {
  neutral: "on-surface-variant",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

function InboxRow({ item }: { item: InboxItem }) {
  const router = useRouter();
  const confirm = useConfirmInboxItem();
  const canConfirm = canConfirmInboxItem(item);
  const headline = parseSummaryHeadline(item);
  const status = inboxStatusPresentation(item.status);

  // The body and the Confirm control are SIBLINGS on an inert card, not
  // nested pressables: under react-native-web a nested Pressable's tap
  // bubbles to the row's own onPress (the rule every list row in this app
  // records), so the button sits beside the body rather than inside it.
  return (
    <Card padding="none" className="mb-3">
      {/* The body opens /inbox/[id] (Checkpoint 9.3, contract 10). The
          destination is built from the row's own server-authored id and
          nothing else -- the text is displayed, never interpreted. */}
      <Pressable
        onPress={() => router.push(`/inbox/${item.id}` as Href)}
        accessibilityRole="button"
        accessibilityLabel="Open this capture"
        hitSlop={4}
        className="flex-row items-start gap-3 p-4 active:opacity-70"
      >
        <View className="pt-0.5">
          <Icon name={status.icon} size="lg" tone={ICON_ROLE[status.tone]} />
        </View>
        <View className="flex-1">
          <AppText variant="body" numberOfLines={3}>
            {item.raw_text !== null
              ? item.raw_text
              : item.status === "failed"
                ? "Transcription failed"
                : "Transcribing…"}
          </AppText>
          {headline !== null ? (
            // A readable line in place of the JSON.stringify(parse_result) this
            // row showed until Checkpoint 9.3.
            <AppText variant="caption" tone="secondary" numberOfLines={2} className="mt-1">
              {headline}
            </AppText>
          ) : null}
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            <StatusChip label={status.label} tone={status.tone} />
            {item.entity_type ? (
              <AppText variant="caption" tone="muted">
                {`-> ${item.entity_type}`}
              </AppText>
            ) : null}
            {(item.status === "needs_confirm" || item.status === "failed") && !canConfirm ? (
              // Not "Can't be filed" any more: the detail screen can file it by hand.
              <AppText variant="caption" tone="warning">
                Tap to file
              </AppText>
            ) : null}
          </View>
        </View>
      </Pressable>
      {canConfirm || confirm.isError ? (
        <View className="px-4 pb-4">
          {canConfirm ? (
            <Button
              label={confirm.isPending ? "Confirming..." : "Confirm as parsed"}
              onPress={() => confirm.mutate({ id: item.id })}
              variant="tonal"
              size="sm"
              icon="check"
              disabled={confirm.isPending}
              accessibilityLabel="Confirm this capture as parsed"
            />
          ) : null}
          {confirm.isError ? (
            <AppText variant="caption" tone="danger" className="mt-2">
              {confirmErrorMessage(confirm.error)}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export default function InboxScreen() {
  // Dismissed (archived) rows are hidden by default and shown on request;
  // the server owns the filter (GET /inbox?include_archived=true).
  const [showDismissed, setShowDismissed] = useState(false);
  const { data, isLoading, isError, isRefetching, refetch } = useInbox(
    showDismissed ? { include_archived: true } : {},
  );
  const { colors } = useTheme();

  return (
    <ScreenFrame>
      <View className="flex-row items-center justify-end px-4 pt-2">
        <Pressable
          onPress={() => setShowDismissed((current) => !current)}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: showDismissed }}
          accessibilityLabel="Show dismissed captures"
          className="min-h-[44px] flex-row items-center gap-1.5 px-2 active:opacity-70"
        >
          <Icon name={showDismissed ? "eye-off-outline" : "eye-outline"} size="sm" tone="primary" />
          <AppText variant="label" tone="primary">
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </AppText>
        </Pressable>
      </View>
      {isLoading ? (
        <SkeletonList className="px-4" />
      ) : isError ? (
        <ErrorState
          size="screen"
          message="Couldn't load the inbox."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading the inbox"
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <InboxRow item={item} />}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-2`}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState
              size="screen"
              icon="inbox-outline"
              title="Inbox is clear"
              body="Captures land here until they're filed."
            />
          }
        />
      )}
    </ScreenFrame>
  );
}
