import { ApiClientError } from "@personal-os/api-client";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import {
  actionDefinitionFor,
  actionErrorLabel,
  actionStatusChip,
} from "@/components/actions/action-approval-sheet-state";
import { buildUndoRequest, undoAvailability } from "@/components/actions/action-center-state";
import {
  ActionRequestSummary,
  openActionApprovalSheet,
} from "@/components/actions/action-approval-sheet";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  ListRow,
  ScreenCentered,
  ScreenFrame,
  SectionHeader,
  SkeletonCard,
  StatusChip,
  Screen,
} from "@/components/ui";
import { coerceActionIdParam, useAction, useCreateActionRequest } from "@/queries/actions";
import { useAgents } from "@/queries/agents";
import { formatShortDateTime } from "@/utils/format-datetime";

// One action request (Checkpoint 10.8, ADR-078 §4/§8): the registry entry,
// the same Why / What-will-change blocks the approval sheet draws (one
// component, so the two never disagree), the row's lifecycle as a timeline,
// and -- for a completed request whose registry entry names a reversal that
// has not already run -- "Undo", which creates a NEW request carrying
// `reverses_request_id` and opens the approval sheet on it. The undo is
// itself approved by the owner; nothing here runs on its own.
//
// Checkpoint 10.9 (ADR-081 §9): the agent list is read here and passed to
// the summary so an agent-sourced request names its agent on the source
// chip and shows its reason quoted under "Agent says".

function TimelineRow({
  label,
  at,
  detail,
  icon,
  tone,
  last,
}: {
  label: string;
  at: string | null;
  detail?: string;
  icon: "send-clock-outline" | "check-circle-outline" | "flag-checkered" | "close-circle-outline";
  tone: "neutral" | "primary" | "success" | "danger";
  last?: boolean;
}) {
  return (
    <ListRow
      icon={icon}
      iconTone={tone}
      title={label}
      subtitle={at ? formatShortDateTime(at) : "—"}
      meta={detail}
      accessibilityLabel={`${label}: ${at ? formatShortDateTime(at) : "not yet"}${detail ? `. ${detail}` : ""}`}
      inset
      last={last}
    />
  );
}

export default function ActionDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = coerceActionIdParam(params.id);
  const { data: item, isLoading, isError, error, refetch, isRefetching } = useAction(id);
  const createRequest = useCreateActionRequest();
  const agents = useAgents();

  if (id === null) {
    return (
      <ScreenCentered>
        <ErrorState title="Not found" message="This action couldn't be found." />
      </ScreenCentered>
    );
  }

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
          message={status === 404 ? "This action couldn't be found." : "Couldn't load this action."}
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this action"
        />
      </ScreenCentered>
    );
  }

  const definition = actionDefinitionFor(item);
  const statusChip = actionStatusChip(item.status);
  const undo = undoAvailability(item);
  const finishedLabel =
    item.status === "completed"
      ? "Completed"
      : item.status === "failed"
        ? "Failed"
        : item.status === "cancelled"
          ? "Cancelled"
          : item.status === "expired"
            ? "Expired"
            : "Finished";

  const onUndo = () => {
    const request = buildUndoRequest(item);
    if (request === null) return;
    // The undo is a NEW pending request: the owner approves it on the sheet.
    createRequest.mutate(request, { onSuccess: (created) => openActionApprovalSheet(created) });
  };

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <Card className="mt-4" testID="action-detail-card">
        <View className="flex-row items-start justify-between gap-3">
          <AppText variant="headline" className="flex-1" testID="action-detail-name">
            {definition.name}
          </AppText>
          <StatusChip
            label={statusChip.label}
            tone={statusChip.tone}
            dot
            size="md"
            accessibilityLabel={`Status: ${statusChip.label}`}
          />
        </View>
        <AppText variant="body" tone="secondary" className="mt-1">
          {definition.description}
        </AppText>
        <View className="mt-4">
          <ActionRequestSummary
            item={item}
            agents={agents.data?.items}
            testID="action-detail-summary"
          />
        </View>
      </Card>

      <SectionHeader title="Timeline" icon="timeline-clock-outline" />
      <Card padding="none" testID="action-detail-timeline">
        <TimelineRow
          label="Requested"
          at={item.requested_at}
          icon="send-clock-outline"
          tone="neutral"
        />
        <TimelineRow
          label="Approved"
          at={item.approved_at}
          icon="check-circle-outline"
          tone="primary"
          last={item.finished_at === null && item.status === "pending"}
        />
        {item.status === "pending" ? null : (
          <TimelineRow
            label={finishedLabel}
            at={item.finished_at}
            detail={
              item.status === "failed"
                ? actionErrorLabel(item.error_class)
                : (item.result_summary ?? undefined)
            }
            icon={item.status === "completed" ? "flag-checkered" : "close-circle-outline"}
            tone={
              item.status === "completed"
                ? "success"
                : item.status === "failed"
                  ? "danger"
                  : "neutral"
            }
            last
          />
        )}
      </Card>

      {item.status === "pending" ? (
        <Button
          label="Review and approve"
          onPress={() => openActionApprovalSheet(item)}
          variant="primary"
          icon="shield-check"
          haptic={false}
          block
          className="mt-4"
          testID="action-detail-review"
        />
      ) : null}

      {undo === "available" ? (
        <Button
          label="Undo"
          onPress={onUndo}
          busy={createRequest.isPending}
          variant="outline"
          icon="undo-variant"
          block
          className="mt-4"
          accessibilityLabel={`Undo: ${item.input_summary}`}
          testID="action-detail-undo"
        />
      ) : null}
      {undo === "undone" ? (
        <View className="mt-4 flex-row">
          <StatusChip label="Undone" tone="neutral" icon="undo-variant" size="md" />
        </View>
      ) : null}
      {createRequest.isError ? (
        <AppText variant="caption" tone="danger" className="mt-2" accessibilityRole="alert">
          Couldn&apos;t propose the undo. Try again.
        </AppText>
      ) : null}
    </Screen>
  );
}
