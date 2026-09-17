import type { InboxItem } from "@personal-os/schema";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import { canConfirmInboxItem, confirmErrorMessage } from "@/components/inbox/confirm-state";
import {
  INBOX_SEGMENTS,
  inboxEmptyCopy,
  inboxQueryParams,
  visibleInboxItems,
  type InboxSegment,
} from "@/components/inbox/inbox-filter";
import { parseSummaryHeadline } from "@/components/inbox/parse-summary";
import { inboxStatusPresentation } from "@/components/inbox/status-presentation";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenFrame,
  SegmentedControl,
  SkeletonList,
  StatusChip,
  useTheme,
} from "@/components/ui";
import { useConfirmInboxItem, useInbox } from "@/queries/inbox";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";

function InboxRow({ item }: { item: InboxItem }) {
  const router = useRouter();
  const confirm = useConfirmInboxItem();
  const canConfirm = canConfirmInboxItem(item);
  const headline = parseSummaryHeadline(item);
  const status = inboxStatusPresentation(item.status);
  const needsHand = (item.status === "needs_confirm" || item.status === "failed") && !canConfirm;

  // The row and the Confirm control are SIBLINGS on an inert card, not
  // nested pressables: under react-native-web a nested Pressable's tap
  // bubbles to the row's own onPress (the rule every list row in this app
  // records), so the button sits below the row rather than inside it -- and
  // the row therefore keeps its own `button` role (no `containsControl`).
  return (
    <Card padding="none" className="mb-3">
      {/* The row opens /inbox/[id] (Checkpoint 9.3, contract 10). The
          destination is built from the row's own server-authored id and
          nothing else -- the text is displayed, never interpreted. Checkpoint
          10.6 moved the row onto ListRow: status disc, capture text, the
          parsed headline as the subtitle, the status chip on the header line. */}
      <ListRow
        icon={status.icon}
        iconTone={status.tone}
        title={
          item.raw_text !== null
            ? item.raw_text
            : item.status === "failed"
              ? "Transcription failed"
              : "Transcribing…"
        }
        subtitle={headline ?? undefined}
        trailing={
          <View className="items-end gap-1">
            <StatusChip label={status.label} tone={status.tone} />
            {item.entity_type ? (
              <AppText variant="caption" tone="muted">
                {`-> ${item.entity_type}`}
              </AppText>
            ) : null}
            {needsHand ? (
              // Not "Can't be filed" any more: the detail screen can file it by hand.
              <AppText variant="caption" tone="warning">
                Tap to file
              </AppText>
            ) : null}
          </View>
        }
        onPress={() => router.push(`/inbox/${item.id}` as Href)}
        accessibilityLabel="Open this capture"
        last
        className="py-3"
      />
      {canConfirm || confirm.isError ? (
        <View className="px-4 pb-3">
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
  // the server owns the filter (GET /inbox?include_archived=true). Checkpoint
  // 10.6 made the request a segment (inbox-filter.ts) in place of the
  // right-aligned "Show dismissed" toggle.
  const [segment, setSegment] = useState<InboxSegment>("open");
  const { data, isLoading, isError, isRefetching, refetch } = useInbox(inboxQueryParams(segment));
  const { colors } = useTheme();
  const items = visibleInboxItems(data?.items ?? [], segment);
  const empty = inboxEmptyCopy(segment);

  return (
    <ScreenFrame>
      <SegmentedControl
        value={segment}
        options={INBOX_SEGMENTS}
        onChange={setSegment}
        className="mx-4 mt-2"
      />
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
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <InboxRow item={item} />}
          contentContainerClassName={`${FLOATING_CLEARANCE} flex-grow px-4 pt-3`}
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
            <EmptyState size="screen" icon="inbox-outline" title={empty.title} body={empty.body} />
          }
        />
      )}
    </ScreenFrame>
  );
}
