import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { ErrorState, ScreenCentered, ScreenFrame, SkeletonCard } from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import {
  EMPTY_FILE_AS_DRAFT,
  defaultTitleFor,
  type FileAsDraft,
  type FileAsKind,
} from "@/components/inbox/build-correction";
import { canFileInboxItem } from "@/components/inbox/confirm-state";
import { InboxDetailView } from "@/components/inbox/inbox-detail-view";
import { deviceTimezone } from "@/components/datetime-field-state";
import {
  INBOX_COMMIT_POLL_INTERVAL_MS,
  INBOX_COMMIT_POLL_MAX,
  useArchiveInboxItem,
  useConfirmInboxItem,
  useInboxItem,
} from "@/queries/inbox";
import { ApiClientError } from "@personal-os/api-client";
import type { ParserToolCall } from "@personal-os/schema";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

// /inbox/[id] -- one captured item (Checkpoint 9.3, D1).
//
// This file is the stateful adapter; the view itself is
// components/inbox/inbox-detail-view.tsx, which is hookless so it can be
// rendered directly by the test harness (src/app is routes-only).
//
// A confirm -- with or without a `corrected_tool_call` -- is 202: the worker
// commits asynchronously. So after one is accepted this screen polls the
// item on a bounded interval until `status` leaves needs_confirm/failed, then
// stops. If the bound runs out it stops too and says so, rather than polling a
// stuck job forever.
export default function InboxItemScreen() {
  const keyboardHeight = useKeyboardHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [awaitingCommit, setAwaitingCommit] = useState(false);
  const [commitPollExhausted, setCommitPollExhausted] = useState(false);
  const pollCount = useRef(0);

  const {
    data: item,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
  } = useInboxItem(id, {
    refetchIntervalMs: awaitingCommit ? INBOX_COMMIT_POLL_INTERVAL_MS : false,
  });
  const confirm = useConfirmInboxItem();
  const archive = useArchiveInboxItem();

  const [draft, setDraft] = useState<FileAsDraft>(EMPTY_FILE_AS_DRAFT);

  // Settle or exhaust the commit poll on every fresh read of the item.
  useEffect(() => {
    if (!awaitingCommit || !item) return;
    if (!canFileInboxItem(item)) {
      setAwaitingCommit(false);
      setCommitPollExhausted(false);
      return;
    }
    pollCount.current += 1;
    if (pollCount.current >= INBOX_COMMIT_POLL_MAX) {
      setAwaitingCommit(false);
      setCommitPollExhausted(true);
    }
    // dataUpdatedAt is the trigger: it changes on every successful refetch,
    // including one that returned an identical row.
  }, [awaitingCommit, item, dataUpdatedAt]);

  const startAwaitingCommit = () => {
    pollCount.current = 0;
    setCommitPollExhausted(false);
    setAwaitingCommit(true);
  };

  if (isLoading || (!isError && !item)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={4} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !item) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={
            status === 404 ? "This capture couldn't be found." : "Couldn't load this capture."
          }
          // A 404 is terminal -- refetching the same id repeats the same
          // answer -- so the affordance appears only for a failure that could
          // actually clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this capture"
        />
      </ScreenCentered>
    );
  }

  const chooseKind = (kind: FileAsKind | null) => {
    if (kind === null) {
      setDraft(EMPTY_FILE_AS_DRAFT);
      return;
    }
    setDraft((current) => ({
      ...current,
      kind,
      // Re-seed the title only when it is untouched or was the previous
      // kind's seed, so an edit survives switching between task and event.
      title:
        current.kind === null ||
        current.title === defaultTitleFor(current.kind, item.raw_text ?? "")
          ? defaultTitleFor(kind, item.raw_text ?? "")
          : current.title,
    }));
  };

  const submitConfirm = (body: { corrected_tool_call?: ParserToolCall }) => {
    confirm.mutate(
      { id: item.id, body },
      {
        onSuccess: () => {
          setDraft(EMPTY_FILE_AS_DRAFT);
          startAwaitingCommit();
        },
      },
    );
  };

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Padding lives entirely in contentContainerStyle (no
        // contentContainerClassName) -- see FLOATING_CLEARANCE_PX for why.
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <InboxDetailView
          item={item}
          draft={draft}
          onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onChooseKind={chooseKind}
          confirm={{ isPending: confirm.isPending, isError: confirm.isError, error: confirm.error }}
          awaitingCommit={awaitingCommit}
          commitPollExhausted={commitPollExhausted}
          dismiss={{ isPending: archive.isPending, isError: archive.isError }}
          onConfirmStored={() => submitConfirm({})}
          onFile={(toolCall) => submitConfirm({ corrected_tool_call: toolCall })}
          onDismiss={() =>
            archive.mutate(item.id, {
              // Reached from a push (which dismissAll()s first) there may be
              // nothing to go back to; the Inbox tab is where the row was.
              onSuccess: () =>
                router.canGoBack() ? router.back() : router.replace("/(tabs)/inbox" as Href),
            })
          }
          // `as Href` for the reason use-notification-lifecycle.ts records: the
          // typed-route union is generated into .expo/types and may predate
          // this changeset. The value itself comes only from entityRoute.
          onOpenEntity={(route) => router.push(route as Href)}
          timezone={deviceTimezone()}
        />
      </ScrollView>
    </ScreenFrame>
  );
}
