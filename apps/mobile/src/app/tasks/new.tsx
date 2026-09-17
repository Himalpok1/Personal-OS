import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { AppText, Button, ScreenFrame } from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { DateTimeField } from "@/components/datetime-field";
import { deviceTimezone } from "@/components/datetime-field-state";
import { TaskRepeatField } from "@/components/recurrence/task-repeat-field";
import { applyDueDateChange } from "@/components/recurrence/task-repeat-state";
import { coerceProjectIdParam, useProjects } from "@/queries/projects";
import { useCreateTask } from "@/queries/tasks";
import { describeValidationError } from "@/utils/validation-error";
import { ENTITY_TITLE_MAX_CHARS, TASK_BODY_MAX_CHARS } from "@personal-os/schema";
import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
  type SerializedRecurrenceRule,
} from "@personal-os/core/recurrence/editor";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

export default function NewTaskScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const createTask = useCreateTask();
  const { data: projects } = useProjects();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [remindAt, setRemindAt] = useState<string | null>(null);
  // A client-side refusal (an unserializable repeat rule); server failures
  // still read from createTask.isError below.
  const [formError, setFormError] = useState<string | null>(null);
  // Preselected via /tasks/new?projectId=<uuid> (project detail "+ Task").
  const [projectId, setProjectId] = useState<string | undefined>(() =>
    coerceProjectIdParam(params.projectId),
  );
  const [recurrence, setRecurrence] = useState<RecurrenceEditorState>({
    enabled: false,
    frequency: "DAILY",
    interval: 1,
    weekdays: [],
    monthDay: null,
    endMode: "never",
    untilDate: null,
    count: null,
    anchor: "due_date",
    timezone: deviceTimezone(),
    isCustom: false,
    rawRrule: null,
  });

  // A Weekly/Monthly repeat follows the due date's weekday / day of month
  // (components/recurrence/task-repeat-state.ts), so the two fields are kept
  // in step here, from the due field's own onChange -- never from an effect.
  const onDueAtChange = (value: string | null) => {
    setDueAt(value);
    setRecurrence((state) =>
      applyDueDateChange(state, { dueAt: value, timezone: deviceTimezone() }),
    );
  };

  const submit = () => {
    if (!title.trim()) return;
    setFormError(null);
    const userTimezone = deviceTimezone();
    let recurrenceFields = {};
    if (recurrence.enabled) {
      // The serializer throws on what the inline advanced editor can hold
      // (a half-typed until date); that is a validation outcome for the
      // banner, not an unhandled throw from a Save tap.
      let serialized: SerializedRecurrenceRule;
      try {
        serialized = serializeEditorStateToRRule(recurrence);
      } catch {
        setFormError("That repeat rule isn't supported.");
        return;
      }
      recurrenceFields = {
        rrule: serialized.rrule,
        recurrence_timezone: serialized.recurrence_timezone ?? userTimezone,
        recurrence_anchor: serialized.recurrence_anchor,
        recurrence_until: serialized.recurrence_until
          ? serialized.recurrence_until.toISOString()
          : undefined,
        recurrence_count: serialized.recurrence_count ?? undefined,
      };
    }

    createTask.mutate(
      {
        title: title.trim(),
        body: body.trim() || undefined,
        due_at: dueAt ?? undefined,
        remind_at: remindAt ?? undefined,
        project_id: projectId,
        timezone: userTimezone,
        ...recurrenceFields,
      },
      { onSuccess: () => router.back() },
    );
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
        <FieldLabel>Title</FieldLabel>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          placeholderTextColor={placeholderColor}
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Title"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={title.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        <FieldLabel>Notes (optional)</FieldLabel>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
          placeholder=""
          maxLength={TASK_BODY_MAX_CHARS}
          accessibilityLabel="Notes"
          className={textFieldClass({ multiline: true, extra: "mb-4 min-h-[80px]" })}
        />
        <FieldLengthCounter length={body.length} maxLength={TASK_BODY_MAX_CHARS} />

        <DateTimeField label="Due date (optional)" value={dueAt} onChange={onDueAtChange} />

        <TaskRepeatField
          value={recurrence}
          onChange={setRecurrence}
          dueAt={dueAt}
          timezone={deviceTimezone()}
        />

        <DateTimeField
          label="Reminder (optional)"
          value={remindAt}
          onChange={setRemindAt}
          warnIfPast
        />

        <FieldLabel>Project (optional)</FieldLabel>
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

        {formError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {formError}
          </AppText>
        ) : createTask.isError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {/* A refused field (client-side parse or a server 400) names the
                field and its bound; anything else keeps the generic line. */}
            {describeValidationError(createTask.error) ?? "Couldn't create that task."}
          </AppText>
        ) : null}

        <Button
          label={createTask.isPending ? "Saving..." : "Create task"}
          onPress={submit}
          // `disabled`, not `busy`: the pending label has always read
          // "Saving...", which `busy` would render as "Create task…".
          disabled={createTask.isPending || !title.trim()}
          variant="primary"
          icon="plus"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
