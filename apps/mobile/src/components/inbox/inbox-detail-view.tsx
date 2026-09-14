import { ENTITY_TITLE_MAX_CHARS, type InboxItem, type ParserToolCall } from "@personal-os/schema";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { DateTimeField } from "@/components/datetime-field";
import { formatFieldLabel } from "@/components/datetime-field-state";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import {
  buildCorrectionFromDraft,
  type FileAsDraft,
  type FileAsKind,
} from "@/components/inbox/build-correction";
import {
  canConfirmInboxItem,
  canFileInboxItem,
  confirmErrorMessage,
} from "@/components/inbox/confirm-state";
import { entityRoute, type EntityRoute } from "@/components/inbox/entity-route";
import { summarizeParseResult } from "@/components/inbox/parse-summary";

// The body of /inbox/[id] (Checkpoint 9.3, D1). Split from the route file for
// the reason components/ask/cloud-ask-card.tsx records: src/app is routes-only
// (a colocated test there registers a bogus route), and this app's test
// harness calls a component directly with no renderer and therefore no
// dispatcher -- so this view holds NO local useState. Every piece of state (the
// item, the File-as draft, the mutation flags) is owned by the route and passed
// in; every change goes back out through a callback.
//
// Every string here lands in a <Text> or a TextInput value. Nothing is
// interpreted, autolinked, or used to derive a route -- destinations come only
// from `entityRoute`, which reads two server-authored fields.

export const STATUS_LABEL: Record<InboxItem["status"], string> = {
  pending: "Parsing…",
  parsed: "Filed",
  needs_confirm: "Needs confirmation",
  confirmed: "Filed (confirmed)",
  failed: "Couldn't file",
};

/** Entry-path labels for CaptureSourceSchema -- how the capture came in, not the platform. */
export const SOURCE_LABEL: Record<InboxItem["source"], string> = {
  web: "Quick capture",
  ptt: "Push-to-talk",
  siri: "Siri",
  assistant: "Assistant",
  share: "Shared",
};

const KIND_LABEL: Record<FileAsKind, string> = { task: "Task", note: "Note", event: "Event" };
const FILE_AS_KINDS: readonly FileAsKind[] = ["task", "note", "event"];

export interface InboxDetailViewProps {
  item: InboxItem;
  draft: FileAsDraft;
  onDraftChange: (patch: Partial<FileAsDraft>) => void;
  /** Choosing a kind seeds the draft title; the route owns that seeding. */
  onChooseKind: (kind: FileAsKind | null) => void;
  confirm: { isPending: boolean; isError: boolean; error: unknown };
  /** A confirm was accepted (202) and the row has not yet left needs_confirm/failed. */
  awaitingCommit: boolean;
  /** The bounded commit poll ran out while the row was still unsettled. */
  commitPollExhausted: boolean;
  dismiss: { isPending: boolean; isError: boolean };
  onConfirmStored: () => void;
  onFile: (toolCall: ParserToolCall) => void;
  onDismiss: () => void;
  onOpenEntity: (route: EntityRoute) => void;
  /** IANA zone used to render the event's computed end. */
  timezone: string;
}

export function InboxDetailView(props: InboxDetailViewProps) {
  const { item, draft } = props;
  const rawText = item.raw_text;
  const summary = summarizeParseResult(item.parse_result);
  const route = entityRoute(item);
  const fileable = canFileInboxItem(item) && rawText !== null;
  const confirmable = canConfirmInboxItem(item);
  const pendingCall =
    fileable && rawText !== null ? buildCorrectionFromDraft(rawText, draft, props.timezone) : null;
  const busy = props.confirm.isPending || props.awaitingCommit;

  return (
    <View>
      {/* The capture itself. */}
      <Text
        testID="inbox-detail-raw-text"
        selectable
        className="text-lg text-black dark:text-white"
      >
        {rawText !== null
          ? rawText
          : item.status === "failed"
            ? "Transcription failed"
            : "Transcribing…"}
      </Text>
      <Text testID="inbox-detail-meta" className="mt-2 text-xs text-neutral-500">
        {SOURCE_LABEL[item.source]} · {STATUS_LABEL[item.status]}
        {formatFieldLabel(item.captured_at) ? ` · ${formatFieldLabel(item.captured_at)}` : ""}
      </Text>

      {/* What the parser made of it. */}
      <View className="mt-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">
        <Text className="mb-1 text-sm font-semibold text-black dark:text-white">Parse result</Text>
        {summary.length === 0 ? (
          <Text testID="inbox-detail-summary-empty" className="text-sm text-neutral-500">
            {item.status === "pending" ? "Not parsed yet." : "Nothing readable was stored."}
          </Text>
        ) : (
          summary.map((line, index) => (
            <Text
              key={`${line.label}-${index}`}
              testID="inbox-detail-summary-line"
              className="text-sm text-neutral-700 dark:text-neutral-300"
            >
              <Text className="text-neutral-500">{line.label}: </Text>
              {line.value}
            </Text>
          ))
        )}
      </View>

      {/* Committed: the tap-through is the primary action. */}
      {route !== null && item.entity_type !== null ? (
        <Pressable
          testID="inbox-detail-open-entity"
          onPress={() => props.onOpenEntity(route)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.entity_type}`}
          className="mt-4 min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Open {item.entity_type}</Text>
        </Pressable>
      ) : null}

      {/* Fileable: confirm the stored guess, or file it by hand. */}
      {fileable ? (
        <View className="mt-4">
          {confirmable ? (
            <Pressable
              testID="inbox-detail-confirm-stored"
              onPress={props.onConfirmStored}
              disabled={busy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Confirm this capture as parsed"
              className="mb-3 min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
            >
              <Text className="font-semibold text-white">
                {props.confirm.isPending ? "Confirming…" : "Confirm as parsed"}
              </Text>
            </Pressable>
          ) : null}

          <Text className="mb-1 text-sm text-neutral-500">
            {confirmable ? "Or file it as something else" : "File it as"}
          </Text>
          <View className="mb-3 flex-row gap-2">
            {FILE_AS_KINDS.map((kind) => {
              const selected = draft.kind === kind;
              return (
                <Pressable
                  key={kind}
                  testID={`inbox-detail-kind-${kind}`}
                  onPress={() => props.onChooseKind(selected ? null : kind)}
                  disabled={busy}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`File as ${KIND_LABEL[kind].toLowerCase()}`}
                  className={
                    selected
                      ? "min-h-[44px] flex-1 items-center justify-center rounded-full bg-blue-600 px-3"
                      : "min-h-[44px] flex-1 items-center justify-center rounded-full bg-neutral-100 px-3 dark:bg-neutral-800"
                  }
                >
                  <Text className={selected ? "text-white" : "text-black dark:text-white"}>
                    {KIND_LABEL[kind]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {draft.kind !== null ? (
            <FileAsForm
              kind={draft.kind}
              draft={draft}
              onDraftChange={props.onDraftChange}
              disabled={busy}
            />
          ) : null}

          {draft.kind !== null ? (
            <Pressable
              testID="inbox-detail-file-submit"
              onPress={() => {
                if (pendingCall !== null) props.onFile(pendingCall);
              }}
              disabled={busy || pendingCall === null}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`File as ${KIND_LABEL[draft.kind].toLowerCase()}`}
              className={
                busy || pendingCall === null
                  ? "min-h-[44px] items-center justify-center rounded-lg bg-blue-300 px-4 py-2 dark:bg-blue-900"
                  : "min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
              }
            >
              <Text className="font-semibold text-white">
                {props.confirm.isPending
                  ? "Filing…"
                  : `File as ${KIND_LABEL[draft.kind].toLowerCase()}`}
              </Text>
            </Pressable>
          ) : null}

          {props.confirm.isError ? (
            <Text
              testID="inbox-detail-confirm-error"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {confirmErrorMessage(props.confirm.error)}
            </Text>
          ) : null}

          {props.awaitingCommit ? (
            <View testID="inbox-detail-awaiting" className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator />
              <Text className="text-sm text-neutral-500">Filing…</Text>
            </View>
          ) : null}
          {props.commitPollExhausted ? (
            <Text
              testID="inbox-detail-poll-exhausted"
              className="mt-2 text-sm text-amber-700 dark:text-amber-500"
            >
              This is taking longer than usual. It will finish in the background; check back
              shortly.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Dismiss: archive the inbox row. Never deletes, never touches the entity. */}
      <Pressable
        testID="inbox-detail-dismiss"
        onPress={props.onDismiss}
        disabled={props.dismiss.isPending || props.confirm.isPending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss this capture from the inbox"
        className="mt-6 min-h-[44px] items-center justify-center rounded-lg bg-neutral-100 px-4 py-2 dark:bg-neutral-800"
      >
        <Text className="font-semibold text-neutral-600 dark:text-neutral-300">
          {props.dismiss.isPending ? "Dismissing…" : "Dismiss"}
        </Text>
      </Pressable>
      {props.dismiss.isError ? (
        <Text
          testID="inbox-detail-dismiss-error"
          className="mt-2 text-sm text-red-600 dark:text-red-400"
        >
          Couldn&apos;t dismiss this capture. Try again.
        </Text>
      ) : null}
      <Text className="mt-2 text-xs text-neutral-500">
        Dismissing hides this capture from the inbox. Anything already filed from it stays.
      </Text>
    </View>
  );
}

function FileAsForm({
  kind,
  draft,
  onDraftChange,
  disabled,
}: {
  kind: FileAsKind;
  draft: FileAsDraft;
  onDraftChange: (patch: Partial<FileAsDraft>) => void;
  disabled: boolean;
}) {
  const placeholderColor = usePlaceholderColor();
  return (
    <View>
      <Text className="mb-1 text-sm text-neutral-500">Title</Text>
      <TextInput
        testID="inbox-detail-title"
        value={draft.title}
        onChangeText={(title) => onDraftChange({ title })}
        editable={!disabled}
        placeholder="Title"
        placeholderTextColor={placeholderColor}
        // The server's bound on a corrected tool call's title
        // (packages/schema/src/text-bounds.ts); build-correction.ts caps at
        // the same constant.
        maxLength={ENTITY_TITLE_MAX_CHARS}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />
      <FieldLengthCounter
        testID="inbox-detail-title-counter"
        length={draft.title.length}
        maxLength={ENTITY_TITLE_MAX_CHARS}
      />
      {kind === "task" ? (
        <DateTimeField
          testID="inbox-detail-due"
          label="Due (optional)"
          value={draft.dueAt}
          onChange={(dueAt) => onDraftChange({ dueAt })}
        />
      ) : null}
      {kind === "event" ? (
        <>
          <DateTimeField
            testID="inbox-detail-start"
            label="Starts"
            value={draft.startAt}
            onChange={(startAt) => onDraftChange({ startAt })}
          />
          <Text className="-mt-2 mb-4 text-xs text-neutral-500">
            Ends one hour after it starts. You can change that on the event afterwards.
          </Text>
        </>
      ) : null}
      {kind === "note" ? (
        <Text className="mb-4 text-xs text-neutral-500">
          The whole capture becomes the note&apos;s body.
        </Text>
      ) : null}
    </View>
  );
}
