import { ENTITY_TITLE_MAX_CHARS, type InboxItem, type ParserToolCall } from "@personal-os/schema";
import { TextInput, View } from "react-native";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { DateTimeField } from "@/components/datetime-field";
import {
  AppText,
  Button,
  Card,
  Icon,
  SectionHeader,
  type ChipTone,
  type ColorRole,
} from "@/components/ui";
import { inboxStatusPresentation } from "@/components/inbox/status-presentation";
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
//
// Checkpoint 10.3 composed it on the design system's hookless primitives
// (Card, Button, ChoiceChip, AppText); every testID, label, state and
// callback is unchanged.

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

// The status icon beside the meta line takes its colour from the status's
// chip tone, through the palette role the Icon primitive reads.
const STATUS_ICON_ROLE: Record<ChipTone, ColorRole> = {
  neutral: "on-surface-variant",
  primary: "primary",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};
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

  const status = inboxStatusPresentation(item.status);

  return (
    <View>
      {/* The capture itself. */}
      <Card>
        <AppText testID="inbox-detail-raw-text" selectable variant="title">
          {rawText !== null
            ? rawText
            : item.status === "failed"
              ? "Transcription failed"
              : "Transcribing…"}
        </AppText>
        <View className="mt-3 flex-row items-center gap-1.5">
          <Icon name={status.icon} size="sm" tone={STATUS_ICON_ROLE[status.tone]} />
          <AppText testID="inbox-detail-meta" variant="caption" tone="muted" className="flex-1">
            {SOURCE_LABEL[item.source]} · {STATUS_LABEL[item.status]}
            {formatFieldLabel(item.captured_at) ? ` · ${formatFieldLabel(item.captured_at)}` : ""}
          </AppText>
        </View>
      </Card>

      {/* What the parser made of it. */}
      <Card className="mt-4">
        <SectionHeader title="Parse result" icon="auto-fix" spacing="card" />
        {summary.length === 0 ? (
          <AppText testID="inbox-detail-summary-empty" variant="body" tone="secondary">
            {item.status === "pending" ? "Not parsed yet." : "Nothing readable was stored."}
          </AppText>
        ) : (
          summary.map((line, index) => (
            <AppText
              key={`${line.label}-${index}`}
              testID="inbox-detail-summary-line"
              variant="body"
              tone="secondary"
            >
              <AppText variant="body" tone="muted">
                {line.label}:{" "}
              </AppText>
              {line.value}
            </AppText>
          ))
        )}
      </Card>

      {/* Committed: the tap-through is the primary action. */}
      {route !== null && item.entity_type !== null ? (
        <Button
          testID="inbox-detail-open-entity"
          label={`Open ${item.entity_type}`}
          onPress={() => props.onOpenEntity(route)}
          accessibilityLabel={`Open ${item.entity_type}`}
          variant="primary"
          block
          className="mt-4"
        />
      ) : null}

      {/* Fileable: confirm the stored guess, or file it by hand. */}
      {fileable ? (
        <Card className="mt-4">
          {confirmable ? (
            <Button
              testID="inbox-detail-confirm-stored"
              label={props.confirm.isPending ? "Confirming…" : "Confirm as parsed"}
              onPress={props.onConfirmStored}
              disabled={busy}
              accessibilityLabel="Confirm this capture as parsed"
              variant="primary"
              block
              className="mb-3"
            />
          ) : null}

          <FieldLabel>{confirmable ? "Or file it as something else" : "File it as"}</FieldLabel>
          <View className="mb-3 flex-row gap-2">
            {FILE_AS_KINDS.map((kind) => {
              const selected = draft.kind === kind;
              return (
                <ChoiceChip
                  key={kind}
                  testID={`inbox-detail-kind-${kind}`}
                  label={KIND_LABEL[kind]}
                  selected={selected}
                  onPress={() => props.onChooseKind(selected ? null : kind)}
                  disabled={busy}
                  accessibilityLabel={`File as ${KIND_LABEL[kind].toLowerCase()}`}
                />
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
            <Button
              testID="inbox-detail-file-submit"
              label={
                props.confirm.isPending
                  ? "Filing…"
                  : `File as ${KIND_LABEL[draft.kind].toLowerCase()}`
              }
              onPress={() => {
                if (pendingCall !== null) props.onFile(pendingCall);
              }}
              disabled={busy || pendingCall === null}
              accessibilityLabel={`File as ${KIND_LABEL[draft.kind].toLowerCase()}`}
              variant="primary"
              block
            />
          ) : null}

          {props.confirm.isError ? (
            <AppText
              testID="inbox-detail-confirm-error"
              variant="body"
              tone="danger"
              className="mt-2"
            >
              {confirmErrorMessage(props.confirm.error)}
            </AppText>
          ) : null}

          {props.awaitingCommit ? (
            <View testID="inbox-detail-awaiting" className="mt-3 flex-row items-center gap-2">
              <Icon name="progress-clock" size="md" tone="primary" />
              <AppText variant="body" tone="secondary">
                Filing…
              </AppText>
            </View>
          ) : null}
          {props.commitPollExhausted ? (
            <AppText
              testID="inbox-detail-poll-exhausted"
              variant="body"
              tone="warning"
              className="mt-2"
            >
              This is taking longer than usual. It will finish in the background; check back
              shortly.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {/* Dismiss: archive the inbox row. Never deletes, never touches the entity. */}
      <Button
        testID="inbox-detail-dismiss"
        label={props.dismiss.isPending ? "Dismissing…" : "Dismiss"}
        onPress={props.onDismiss}
        disabled={props.dismiss.isPending || props.confirm.isPending}
        accessibilityLabel="Dismiss this capture from the inbox"
        variant="outline"
        block
        className="mt-6"
      />
      {props.dismiss.isError ? (
        <AppText testID="inbox-detail-dismiss-error" variant="body" tone="danger" className="mt-2">
          Couldn&apos;t dismiss this capture. Try again.
        </AppText>
      ) : null}
      <AppText variant="caption" tone="muted" className="mt-2">
        Dismissing hides this capture from the inbox. Anything already filed from it stays.
      </AppText>
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
      <FieldLabel>Title</FieldLabel>
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
        accessibilityLabel="Title"
        className={textFieldClass({ extra: "mb-4" })}
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
          <AppText variant="caption" tone="muted" className="-mt-2 mb-4">
            Ends one hour after it starts. You can change that on the event afterwards.
          </AppText>
        </>
      ) : null}
      {kind === "note" ? (
        <AppText variant="caption" tone="muted" className="mb-4">
          The whole capture becomes the note&apos;s body.
        </AppText>
      ) : null}
    </View>
  );
}
