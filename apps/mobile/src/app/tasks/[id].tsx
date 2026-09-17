import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  assignmentLabelQueryKey,
  rememberAcademicAssignments,
  type LinkedAssignmentSummary,
} from "@/components/academic/academic-assignment-cache";
import { TaskAssignmentPicker } from "@/components/academic/task-assignment-picker";
import { ProjectLinkRow } from "@/components/projects/project-link-row";
import {
  AppText,
  Button,
  ErrorState,
  ScreenCentered,
  ScreenFrame,
  SkeletonCard,
  showToast,
} from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { DateTimeField } from "@/components/datetime-field";
import { deviceTimezone } from "@/components/datetime-field-state";
import { TaskRepeatField } from "@/components/recurrence/task-repeat-field";
import { applyDueDateChange } from "@/components/recurrence/task-repeat-state";
import { TaskActions } from "@/components/task-actions";
import { buildTaskUpdatePatch } from "@/components/task-update-patch";
import { useAcademicCourse, useAcademicCourses } from "@/queries/academic";
import { useProjects } from "@/queries/projects";
import { useArchiveTask, useTask, useUpdateTask } from "@/queries/tasks";
import { describeValidationError } from "@/utils/validation-error";
import { ApiClientError } from "@personal-os/api-client";
import {
  ENTITY_TITLE_MAX_CHARS,
  TASK_BODY_MAX_CHARS,
  type AcademicAssignment,
  type TaskUpdate,
} from "@personal-os/schema";
import {
  parseRRuleStringToEditorState,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

export default function EditTaskScreen() {
  const keyboardHeight = useKeyboardHeight();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const { data: projects } = useProjects();
  const updateTask = useUpdateTask();
  const archiveTask = useArchiveTask();

  // Links this task to a Canvas assignment (Checkpoint 10.5, ADR-074): the
  // picker's own course/assignment fetches and expand/collapse state live
  // here, exactly how the events screen owns EditEventView's calendar-link
  // state -- TaskAssignmentPicker stays hook-free and prop-driven.
  const [assignmentPickerExpanded, setAssignmentPickerExpanded] = useState(false);
  const [pickerCourseId, setPickerCourseId] = useState<string | null>(null);
  const { data: pickerCourses } = useAcademicCourses({ includePastTerms: true });
  const { data: pickerCourseDetail, dataUpdatedAt: pickerCourseFetchedAt } = useAcademicCourse(
    assignmentPickerExpanded ? pickerCourseId : null,
  );
  // Whenever the picker loads a course's assignments, remember their
  // titles/course labels so THIS screen (and any other open one) can show a
  // linked assignment's text without a dedicated lookup route -- see
  // academic-assignment-cache.ts's own header for the honest limits of this.
  useEffect(() => {
    if (pickerCourseDetail) rememberAcademicAssignments(queryClient, pickerCourseDetail.assignments);
  }, [pickerCourseDetail, queryClient]);

  const linkedAssignmentId = task?.canvas_assignment_id ?? null;
  // A pure cache read, never a fetch: there is no "get one assignment by id"
  // route, so `enabled: false` keeps this from ever calling queryFn while
  // still subscribing to the setQueryData writes rememberAcademicAssignments
  // makes above (and from the course screen, and from a second visit to the
  // picker) -- see academic-assignment-cache.ts.
  const linkedLabel = useQuery<LinkedAssignmentSummary | undefined>({
    queryKey: linkedAssignmentId
      ? assignmentLabelQueryKey(linkedAssignmentId)
      : ["academic", "assignment-label", "none"],
    queryFn: () => Promise.resolve(undefined),
    enabled: false,
    staleTime: Infinity,
  }).data;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  // Save/Archive failures (Checkpoint 9.3). Previously `updateTask.mutate`
  // had no onError at all, so a failed save left the form exactly as it was
  // with nothing to say why -- and `router.back()` never happened, which was
  // the only hint. The lifecycle actions carry their own banner inside
  // <TaskActions>.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>(() =>
    parseRRuleStringToEditorState(task?.rrule, {
      recurrenceTimezone: task?.recurrence_timezone,
      recurrenceUntil: task?.recurrence_until,
      recurrenceCount: task?.recurrence_count,
      recurrenceAnchor: task?.recurrence_anchor,
      defaultTimezone: task?.timezone,
    }),
  );

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setBody(task.body ?? "");
    setDueAt(task.due_at);
    setRemindAt(task.remind_at);
    setProjectId(task.project_id ?? undefined);
    setRecurrence(
      parseRRuleStringToEditorState(task.rrule, {
        recurrenceTimezone: task.recurrence_timezone,
        recurrenceUntil: task.recurrence_until,
        recurrenceCount: task.recurrence_count,
        recurrenceAnchor: task.recurrence_anchor,
        defaultTimezone: task.timezone,
      }),
    );
  }, [task]);

  if (isLoading || (!isError && !task)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={4} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !task) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={status === 404 ? "This task couldn't be found." : "Couldn't load this task."}
          // A 404 is terminal -- refetching the same id repeats the same
          // answer -- so the affordance appears only for a failure that could
          // actually clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this task"
        />
      </ScreenCentered>
    );
  }

  // A Weekly/Monthly repeat follows the due date's weekday / day of month
  // (components/recurrence/task-repeat-state.ts), so the two fields are kept
  // in step here, from the due field's own onChange -- never from an effect,
  // which would rewrite the loaded rule on mount before the owner touched it.
  const onDueAtChange = (value: string | null) => {
    setDueAt(value);
    setRecurrence((state) =>
      applyDueDateChange(state, { dueAt: value, timezone: deviceTimezone() }),
    );
  };

  const submit = () => {
    setSaveError(null);
    // A diff against the loaded task (Checkpoint 9.4): the recurrence fields
    // and due_at travel only when they changed, so a title edit never
    // re-expands the series -- see components/task-update-patch.ts.
    //
    // Building the diff SERIALIZES the repeat state, and the serializer
    // throws on what the inline advanced editor can hold -- a half-typed
    // until date, say. That is a form-validation outcome, not a crash: it
    // lands in the same banner a server-side rule rejection does.
    let patch: TaskUpdate;
    try {
      patch = buildTaskUpdatePatch(task, {
        title,
        body,
        dueAt,
        remindAt,
        projectId,
        recurrence,
      });
    } catch {
      setSaveError("That repeat rule isn't supported.");
      return;
    }
    updateTask.mutate(
      { id: task.id, body: patch },
      {
        onSuccess: () => router.back(),
        // Never the raw message -- `ApiClientError.message` is the
        // developer-shaped `API error 400: validation_failed`.
        //
        // A refused field -- a server 400 or the api-client's own pre-request
        // parse (a raw ZodError) -- names the field and its bound. The
        // recurrence fields are in the body only when the repeat changed, so
        // a 400 with an rrule present and no field-level line is about the
        // rule.
        onError: (err) => {
          const fieldLine = describeValidationError(err);
          setSaveError(
            fieldLine !== null
              ? patch.rrule && !fieldLine.includes("must be at most")
                ? "That repeat rule isn't supported."
                : fieldLine
              : err instanceof ApiClientError && err.status === 404
                ? "This task couldn't be found."
                : "Couldn't save those changes. Please try again.",
          );
        },
      },
    );
  };

  // The link picker mutates immediately on selection/clear -- it is its own
  // action, like TaskActions' status buttons below, not a field deferred to
  // the Save button (the server validates the id against a real
  // canvas_assignments row; describeValidationError already knows how to
  // turn that 400 into a line).
  const setAssignmentLink = (assignmentId: string | null) => {
    if (!task) return;
    setSaveError(null);
    updateTask.mutate(
      { id: task.id, body: { canvas_assignment_id: assignmentId } },
      {
        onError: (err) =>
          setSaveError(
            describeValidationError(err) ?? "Couldn't update the linked assignment. Please try again.",
          ),
      },
    );
    setAssignmentPickerExpanded(false);
    setPickerCourseId(null);
  };

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Padding lives entirely in contentContainerStyle (no
        // contentContainerClassName) because NativeWind remaps that class onto
        // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
        // globally-mounted QuickAdd/PTT buttons off this form's Save/Archive
        // control; the keyboard height gives room to scroll it clear of the IME.
        // Extra room so lower controls can be scrolled clear of the IME --
        // see components/use-keyboard-height.ts for why insets alone don't do it.
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        // Without this the first tap on a submit button below a focused field
        // only dismisses the keyboard instead of submitting.
        keyboardShouldPersistTaps="handled"
      >
        {/* Status line + Start/Complete/Drop/Reopen + snooze chips. Sits above
            the form so the one-tap follow-through (the point of 9.3) is reachable
            without scrolling past the editor on a 480x640 screen. */}
        <TaskActions task={task} />

        <ProjectLinkRow
          projectId={task.project_id}
          projects={projects}
          onPress={() => router.push(`/projects/${task.project_id}`)}
          className="mb-4"
        />

        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={title}
          onChangeText={setTitle}
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Title"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={title.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        <FieldLabel>Notes</FieldLabel>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
          maxLength={TASK_BODY_MAX_CHARS}
          accessibilityLabel="Notes"
          className={textFieldClass({ multiline: true, extra: "mb-4" })}
        />
        <FieldLengthCounter length={body.length} maxLength={TASK_BODY_MAX_CHARS} />

        <DateTimeField label="Due date" value={dueAt} onChange={onDueAtChange} />

        <TaskRepeatField
          value={recurrence}
          onChange={setRecurrence}
          dueAt={dueAt}
          timezone={deviceTimezone()}
        />

        <DateTimeField label="Reminder" value={remindAt} onChange={setRemindAt} warnIfPast />

        <FieldLabel>Project</FieldLabel>
        <View className="mb-4 flex-row flex-wrap gap-2">
          {(projects ?? []).map((project) => (
            <ChoiceChip
              key={project.id}
              label={project.name}
              selected={projectId === project.id}
              onPress={() => setProjectId(projectId === project.id ? undefined : project.id)}
              accessibilityLabel={`Project: ${project.name}`}
            />
          ))}
        </View>

        <TaskAssignmentPicker
          expanded={assignmentPickerExpanded}
          onToggleExpanded={() => setAssignmentPickerExpanded((value) => !value)}
          isLinked={linkedAssignmentId !== null}
          linkedTitle={linkedLabel?.title ?? null}
          linkedCourseLabel={linkedLabel?.courseLabel ?? null}
          courses={pickerCourses?.items ?? []}
          selectedCourseId={pickerCourseId}
          onSelectCourse={setPickerCourseId}
          courseAssignments={pickerCourseDetail?.assignments ?? null}
          courseAssignmentsFetchedAt={pickerCourseFetchedAt}
          onSelectAssignment={(assignment: AcademicAssignment) => setAssignmentLink(assignment.id)}
          onClear={() => setAssignmentLink(null)}
          disabled={updateTask.isPending}
        />

        {saveError ? (
          <AppText variant="body" tone="danger" className="mb-2" accessibilityRole="alert">
            {saveError}
          </AppText>
        ) : null}

        <Button
          label={updateTask.isPending ? "Saving..." : "Save changes"}
          onPress={submit}
          disabled={updateTask.isPending}
          variant="primary"
          icon="content-save-outline"
          block
          className="mb-3"
        />

        <Button
          label={archiveTask.isPending ? "Archiving..." : "Archive task"}
          onPress={() =>
            confirmDestructive({
              title: "Archive this task?",
              message:
                "This hides it from your lists. There's currently no way to view or restore it from the app.",
              confirmLabel: "Archive",
              onConfirm: () => {
                setSaveError(null);
                archiveTask.mutate(task.id, {
                  // The toast outlives this screen (root-mounted host), so
                  // it is what confirms the archive once the list is back.
                  onSuccess: () => {
                    showToast({ message: "Task archived" });
                    router.back();
                  },
                  onError: () => setSaveError("Couldn't archive this task. Please try again."),
                });
              },
            })
          }
          disabled={archiveTask.isPending}
          variant="danger"
          icon="archive-arrow-down-outline"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
