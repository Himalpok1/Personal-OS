import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { confirmDestructive } from "@/components/confirm-destructive";
import { RecentActivitySection } from "@/components/projects/recent-activity-section";
import { RelatedCapturesSection } from "@/components/projects/related-captures-section";
import { projectProgress } from "@/components/projects/project-progress";
import {
  PROJECT_STALLED_PRESENTATION,
  projectDisplayStatus,
  projectStatusPresentation,
} from "@/components/projects/status-presentation";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Icon,
  ListRow,
  ProgressBar,
  ScreenCentered,
  ScreenFrame,
  SectionHeader,
  SkeletonCard,
  StatusChip,
  useTheme,
  type ButtonVariant,
} from "@/components/ui";
import { ApiClientError } from "@personal-os/api-client";
import {
  ENTITY_TITLE_MAX_CHARS,
  PROJECT_GOAL_MAX_CHARS,
  type ProjectDetailEvent,
  type ProjectUpdate,
} from "@personal-os/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { useCompleteOccurrence } from "@/queries/occurrences";
import {
  useArchiveProject,
  useCompleteProject,
  usePauseProject,
  useProjectContext,
  useProjectDetail,
  useReopenProject,
  useResumeProject,
  useUnarchiveProject,
  useUpdateProject,
} from "@/queries/projects";
import { useCompleteTask } from "@/queries/tasks";
import { fetchMemorySuggestionForProject } from "@/queries/memory";
import { showMemorySuggestion } from "@/components/memory/memory-suggestion-sheet";
import { formatShortDateTime } from "@/utils/format-datetime";
import { formatShortDate } from "@/utils/local-date";
import { describeValidationError } from "@/utils/validation-error";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function eventStartLabel(event: ProjectDetailEvent): string | null {
  if (event.all_day) return event.start_date ? formatShortDate(event.start_date) : null;
  return event.starts_at ? `Starts ${formatShortDateTime(event.starts_at)}` : null;
}

// A lifecycle action, one of an equal-width row (Checkpoint 10.3: the design
// system's Button; `variant` replaced the per-action colour classes).
function ActionButton({
  label,
  onPress,
  disabled,
  variant = "outline",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      label={label}
      onPress={onPress}
      disabled={disabled}
      variant={variant}
      size="sm"
      className="flex-1"
    />
  );
}

/**
 * Safe copy for a failed project lifecycle or archive action.
 *
 * These two sites rendered `ApiClientError.message` straight to the screen,
 * which reads `API error 409: invalid_status_transition` -- a developer string,
 * and the same class of defect Checkpoint 6.5 removed from Settings and the
 * calendar link picker. Switching on `.code` keeps the one distinction that is
 * actually actionable here (the state moved underneath you) and says nothing
 * else.
 */
function describeProjectActionFailure(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "invalid_status_transition") {
      return "That project's status changed. Pull to refresh and try again.";
    }
    if (err.status === 404) return "That project no longer exists.";
  }
  return "That didn't go through. Please try again.";
}

export default function ProjectDetailScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useProjectDetail(id);
  // Related Captures + Recent Activity (Checkpoint 10.5, ADR-074) -- a
  // separate query from useProjectDetail above, so a slow/failing context
  // fetch never blanks the name/goal/tasks/notes/events this screen already
  // edits; see queries/projects.ts's own doc comment.
  const { data: context } = useProjectContext(id);
  const updateProject = useUpdateProject();
  const pauseProject = usePauseProject();
  const resumeProject = useResumeProject();
  const completeProject = useCompleteProject();
  const reopenProject = useReopenProject();
  const archiveProject = useArchiveProject();
  const unarchiveProject = useUnarchiveProject();
  const completeTask = useCompleteTask();
  const completeOccurrence = useCompleteOccurrence();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [targetDate, setTargetDate] = useState("");
  // A refused metadata save (name/goal/target date commit on blur). Before
  // 9.6 `updateProject.mutate` had no onError, so a rejected field simply
  // reverted on the next refetch with nothing to say why.
  const [metadataError, setMetadataError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setName(data.project.name);
      setGoal(data.project.goal ?? "");
      setTargetDate(data.project.target_date ?? "");
    }
  }, [data]);

  if (isError) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={status === 404 ? "Project not found." : "Couldn't load project."}
          // A 404 is terminal -- retrying it just repeats the same answer -- so
          // the affordance appears only for a load failure that could clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this project"
        />
      </ScreenCentered>
    );
  }

  if (isLoading || !data) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={5} />
        </View>
      </ScreenFrame>
    );
  }

  const { project, computed, tasks, notes, events } = data;

  // Task writes change this project's computed strip (counts/next action) and
  // Today's read model; occurrences matter for the recurring fallback path.
  const invalidateAfterTaskWrite = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["occurrences"] });
  };

  const onCompleteTask = (taskId: string) => {
    completeTask.mutate(taskId, {
      onSuccess: invalidateAfterTaskWrite,
      onError: (err) => {
        if (err instanceof ApiClientError && err.status === 409) {
          const occurrenceId = (err.body as { occurrence_id?: string | null })?.occurrence_id;
          if (occurrenceId) {
            completeOccurrence.mutate(occurrenceId, { onSuccess: invalidateAfterTaskWrite });
          }
        }
      },
    });
  };

  const commitMetadata = (body: ProjectUpdate) => {
    setMetadataError(null);
    updateProject.mutate(
      { id: project.id, body },
      {
        // The explicit moment (Checkpoint 10.7, ADR-077 §4): a goal was just
        // saved and is non-empty, so ask ONCE whether the server has a
        // `project_goal` suggestion for THIS project and, if so, offer it in
        // the root-mounted sheet. Nothing else on this screen -- no edit, no
        // completion, no visit -- opens it; a failed lookup opens nothing.
        onSuccess: () => {
          if (typeof body.goal === "string" && body.goal.length > 0) {
            void fetchMemorySuggestionForProject(queryClient, project.id).then((suggestion) => {
              if (suggestion) showMemorySuggestion(suggestion);
            });
          }
        },
        // A refused field (a server 400 or the api-client's pre-request parse)
        // names the field and its bound; anything else keeps a generic line.
        onError: (err) =>
          setMetadataError(
            describeValidationError(err) ?? "Couldn't save that change. Please try again.",
          ),
      },
    );
  };

  const lifecyclePending =
    pauseProject.isPending ||
    resumeProject.isPending ||
    completeProject.isPending ||
    reopenProject.isPending;
  const lifecycleError = [pauseProject, resumeProject, completeProject, reopenProject].find(
    (m) => m.isError,
  )?.error;
  const archiveError = archiveProject.isError
    ? archiveProject.error
    : unarchiveProject.isError
      ? unarchiveProject.error
      : null;

  const openTasks = tasks.items.filter((t) => t.status === "inbox" || t.status === "active");
  const closedTasks = tasks.items.filter((t) => t.status === "done" || t.status === "dropped");

  // The hero reads the status the Projects tab reads (archived wins over the
  // lifecycle status), so the two screens can never disagree about one row.
  const displayStatus = projectDisplayStatus(project);
  const status = projectStatusPresentation(displayStatus);
  // Done over open + done (project-progress.ts); null -- no bar -- when the
  // project has neither, so an empty project is not drawn as "0% done".
  const progress = projectProgress(computed.counts);
  const taskRowPending = completeTask.isPending || completeOccurrence.isPending;
  const heroSpoken = [
    `${project.name}, ${status.label}`,
    computed.stalled ? PROJECT_STALLED_PRESENTATION.label : null,
    progress ? progress.label : "no tasks yet",
    computed.next_action ? `next: ${computed.next_action.title}` : "no next action",
  ]
    .filter((part): part is string => part !== null)
    .join(". ");

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Extra room so lower controls can be scrolled clear of the IME --
        // see components/use-keyboard-height.ts for why insets alone don't do it.
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* A view-first hero ABOVE the form (Checkpoint 10.6): the project as a
            reader sees it -- colour, name, status, progress, next action -- all
            from the same detail query, before the editable fields below. */}
        <Card className="mb-4" accessibilityLabel={heroSpoken}>
          <View className="flex-row items-center gap-2">
            <View
              className="h-4 w-4 rounded-full"
              // The project's own colour is data; the fallback is the palette's
              // muted role rather than a hex of this screen's own.
              style={{ backgroundColor: project.color ?? colors["on-surface-muted"] }}
            />
            <AppText variant="title" numberOfLines={2} className="flex-1">
              {project.name}
            </AppText>
            {computed.stalled ? (
              <StatusChip
                label={PROJECT_STALLED_PRESENTATION.label}
                tone={PROJECT_STALLED_PRESENTATION.tone}
              />
            ) : null}
            <StatusChip label={status.label} tone={status.tone} />
          </View>
          {progress ? (
            <ProgressBar
              value={progress.fraction}
              tone={displayStatus === "completed" ? "success" : "primary"}
              accessibilityLabel={progress.label}
              className="mt-3"
            />
          ) : null}
          <AppText variant="caption" tone="muted" className="mt-1.5">
            {progress ? progress.label : "No tasks yet"} · {computed.counts.overdue} overdue
            {project.target_date ? ` · Target ${formatShortDate(project.target_date)}` : ""}
          </AppText>
          <AppText
            variant="label"
            tone={computed.next_action ? "secondary" : "muted"}
            numberOfLines={1}
            className="mt-1.5 font-normal"
          >
            {computed.next_action ? `Next: ${computed.next_action.title}` : "No next action"}
          </AppText>
        </Card>

        <SectionHeader title="Details" icon="pencil-outline" spacing="none" className="pb-2" />
        <FieldLabel>Name</FieldLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== project.name) commitMetadata({ name: trimmed });
          }}
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Project name"
          className={textFieldClass({ extra: "mb-4 text-title font-semibold" })}
        />

        <FieldLengthCounter length={name.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        <FieldLabel>Goal</FieldLabel>
        <TextInput
          value={goal}
          onChangeText={setGoal}
          multiline
          textAlignVertical="top"
          placeholder="What does done look like?"
          placeholderTextColor={placeholderColor}
          onBlur={() => {
            const trimmed = goal.trim();
            if (trimmed !== (project.goal ?? "")) commitMetadata({ goal: trimmed || null });
          }}
          maxLength={PROJECT_GOAL_MAX_CHARS}
          accessibilityLabel="Goal"
          // mb-4 so the counter below can tuck into the gap.
          className={textFieldClass({ extra: "mb-4 max-h-[120px] min-h-[48px]" })}
        />
        <FieldLengthCounter length={goal.length} maxLength={PROJECT_GOAL_MAX_CHARS} />
        {/* A refused name/goal/target-date save is shown HERE, directly under
            the fields it refers to, rather than below the lifecycle buttons and
            the task list: on a 480x640 screen that was below the fold, so the
            refusal was invisible exactly when the owner was looking at the
            field that caused it. */}
        {metadataError ? (
          <AppText
            testID="project-metadata-error"
            variant="body"
            tone="danger"
            className="-mt-2 mb-4"
            accessibilityRole="alert"
          >
            {metadataError}
          </AppText>
        ) : null}

        <FieldLabel>Target date (YYYY-MM-DD)</FieldLabel>
        <TextInput
          value={targetDate}
          onChangeText={setTargetDate}
          placeholder="2026-12-31"
          placeholderTextColor={placeholderColor}
          onBlur={() => {
            const value = targetDate.trim();
            if (value === project.target_date) return;
            if (!value || DATE_PATTERN.test(value)) commitMetadata({ target_date: value || null });
          }}
          accessibilityLabel="Target date"
          className={textFieldClass({ extra: "mb-4" })}
        />

        <View className="flex-row gap-2">
          {project.status === "active" ? (
            <>
              <ActionButton
                label="Pause"
                disabled={lifecyclePending}
                onPress={() => pauseProject.mutate(project.id)}
                variant="tonal"
              />
              <ActionButton
                label="Complete"
                disabled={lifecyclePending}
                onPress={() => completeProject.mutate(project.id)}
                variant="primary"
              />
            </>
          ) : null}
          {project.status === "paused" ? (
            <>
              <ActionButton
                label="Resume"
                disabled={lifecyclePending}
                onPress={() => resumeProject.mutate(project.id)}
                variant="tonal"
              />
              <ActionButton
                label="Complete"
                disabled={lifecyclePending}
                onPress={() => completeProject.mutate(project.id)}
                variant="primary"
              />
            </>
          ) : null}
          {project.status === "completed" ? (
            <ActionButton
              label="Reopen"
              disabled={lifecyclePending}
              onPress={() => reopenProject.mutate(project.id)}
              variant="outline"
            />
          ) : null}
          {project.archived_at ? (
            <ActionButton
              label="Unarchive"
              disabled={unarchiveProject.isPending}
              onPress={() => unarchiveProject.mutate(project.id)}
              variant="outline"
            />
          ) : (
            <ActionButton
              label="Archive"
              disabled={archiveProject.isPending}
              onPress={() =>
                confirmDestructive({
                  title: "Archive this project?",
                  message:
                    "This hides it from your lists. You can restore it later from the Archived section on the Projects tab.",
                  confirmLabel: "Archive",
                  onConfirm: () => archiveProject.mutate(project.id),
                })
              }
              variant="danger"
            />
          )}
        </View>
        {lifecycleError ? (
          <AppText variant="body" tone="danger" className="mt-2">
            {describeProjectActionFailure(lifecycleError)}
          </AppText>
        ) : null}
        {archiveError ? (
          <AppText variant="body" tone="danger" className="mt-2">
            {describeProjectActionFailure(archiveError)}
          </AppText>
        ) : null}

        <Card className="mt-4">
          <SectionHeader title="Next action" icon="flag-outline" spacing="card" />
          {computed.next_action ? (
            <>
              <Pressable
                onPress={() => router.push(`/tasks/${computed.next_action!.task_id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open task: ${computed.next_action.title}`}
                hitSlop={4}
                className="min-h-[44px] justify-center active:opacity-70"
              >
                <AppText variant="body-strong" numberOfLines={2}>
                  {computed.next_action.title}
                </AppText>
              </Pressable>
              <AppText variant="caption" tone="secondary" className="mt-0.5">
                {computed.next_action.due_at
                  ? `Due ${formatShortDateTime(computed.next_action.due_at)}`
                  : "No due date"}
                {computed.next_action.priority !== null
                  ? ` · Priority ${computed.next_action.priority}`
                  : ""}
              </AppText>
            </>
          ) : (
            <AppText variant="body" tone="secondary" className="mt-1">
              No next action
            </AppText>
          )}
          <View className="mt-2 flex-row items-center gap-2">
            {computed.stalled ? (
              <StatusChip
                label={PROJECT_STALLED_PRESENTATION.label}
                tone={PROJECT_STALLED_PRESENTATION.tone}
              />
            ) : null}
            <AppText variant="caption" tone="muted">
              {computed.counts.open} open · {computed.counts.done} done · {computed.counts.overdue}{" "}
              overdue
            </AppText>
          </View>
          {computed.last_activity_at ? (
            <AppText variant="caption" tone="muted" className="mt-1">
              Last activity {formatShortDateTime(computed.last_activity_at)}
            </AppText>
          ) : null}
        </Card>

        <SectionHeader
          title="Tasks"
          count={tasks.total}
          action={{
            label: "+ Task",
            onPress: () => router.push(`/tasks/new?projectId=${project.id}`),
            accessibilityLabel: "New task in this project",
          }}
        />
        {tasks.items.length === 0 ? (
          <AppText variant="body" tone="secondary">
            No tasks in this project.
          </AppText>
        ) : (
          <Card padding="none">
            {openTasks.map((task, index) => (
              <View key={task.id} className="flex-row items-center pl-2">
                {/* The completion circle and the row are SIBLINGS, not nested
                    pressables (a nested tap bubbles to the row under
                    react-native-web). */}
                <Pressable
                  onPress={() => onCompleteTask(task.id)}
                  disabled={taskRowPending}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark "${task.title}" done`}
                  className="h-11 w-11 items-center justify-center active:opacity-70"
                >
                  <Icon
                    name={taskRowPending ? "progress-clock" : "checkbox-blank-circle-outline"}
                    size="lg"
                    tone={taskRowPending ? "on-surface-muted" : "on-surface-variant"}
                  />
                </Pressable>
                <ListRow
                  title={task.title}
                  meta={
                    [
                      task.due_at ? `Due ${formatShortDateTime(task.due_at)}` : null,
                      task.rrule ? "Recurring" : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(" · ") || undefined
                  }
                  onPress={() => router.push(`/tasks/${task.id}`)}
                  accessibilityLabel={`Open task: ${task.title}`}
                  inset
                  last={index === openTasks.length - 1 && closedTasks.length === 0}
                  className="flex-1 pr-4"
                />
              </View>
            ))}
            {closedTasks.map((task, index) => (
              <ListRow
                key={task.id}
                title={task.title}
                done
                meta={
                  task.status === "done"
                    ? task.completed_at
                      ? `Done ${formatShortDateTime(task.completed_at)}`
                      : "Done"
                    : "Dropped"
                }
                onPress={() => router.push(`/tasks/${task.id}`)}
                accessibilityLabel={`Open task: ${task.title}`}
                last={index === closedTasks.length - 1}
              />
            ))}
            {tasks.total > tasks.items.length ? (
              <AppText variant="caption" tone="muted" className="px-4 py-2">
                &gt;{tasks.total - tasks.items.length} more
              </AppText>
            ) : null}
          </Card>
        )}

        <SectionHeader
          title="Notes"
          count={notes.total}
          action={{
            label: "+ Note",
            onPress: () => router.push(`/notes/new?projectId=${project.id}`),
            accessibilityLabel: "New note in this project",
          }}
        />
        {notes.items.length === 0 ? (
          <AppText variant="body" tone="secondary">
            No notes in this project.
          </AppText>
        ) : (
          <Card padding="none">
            {(notes.items ?? []).map((note, index) => (
              <ListRow
                key={note.id}
                icon="note-text-outline"
                title={note.title}
                onPress={() => router.push(`/notes/${note.id}`)}
                accessibilityLabel={`Open note: ${note.title}`}
                chevron
                last={index === notes.items.length - 1}
              />
            ))}
            {notes.total > notes.items.length ? (
              <AppText variant="caption" tone="muted" className="px-4 py-2">
                &gt;{notes.total - notes.items.length} more
              </AppText>
            ) : null}
          </Card>
        )}

        <SectionHeader
          title="Events"
          count={events.total}
          action={{
            label: "+ Event",
            onPress: () => router.push(`/events/new?projectId=${project.id}`),
            accessibilityLabel: "New event in this project",
          }}
        />
        {events.items.length === 0 ? (
          <AppText variant="body" tone="secondary">
            No events in this project.
          </AppText>
        ) : (
          <Card padding="none">
            {(events.items ?? []).map((event, index) => {
              const start = eventStartLabel(event);
              return (
                <ListRow
                  key={event.id}
                  icon={event.rrule ? "calendar-refresh-outline" : "calendar"}
                  title={event.title}
                  meta={start ?? undefined}
                  onPress={() => router.push(`/events/${event.id}`)}
                  accessibilityLabel={`Open event: ${event.title}`}
                  chevron
                  last={index === events.items.length - 1}
                />
              );
            })}
            {events.total > events.items.length ? (
              <AppText variant="caption" tone="muted" className="px-4 py-2">
                &gt;{events.total - events.items.length} more
              </AppText>
            ) : null}
          </Card>
        )}

        {/* Captures that became one of this project's own items, and a
            recent-activity feed (Checkpoint 10.5, ADR-074) -- both render
            nothing while the context query is still loading, has failed, or
            the section is genuinely empty; see each component's own header. */}
        {context ? (
          <RelatedCapturesSection
            captures={context.related_captures}
            onOpenCapture={(captureId) => router.push(`/inbox/${captureId}`)}
          />
        ) : null}
        {context ? <RecentActivitySection activity={context.recent_activity} /> : null}
      </ScrollView>
    </ScreenFrame>
  );
}
