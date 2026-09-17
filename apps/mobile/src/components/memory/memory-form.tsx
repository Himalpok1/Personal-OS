import {
  MEMORY_NOTE_MAX_CHARS,
  MEMORY_STATEMENT_MAX_CHARS,
  type AcademicCourseSummary,
  type MemoryKind,
} from "@personal-os/schema";
import { TextInput, View } from "react-native";
import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { courseLabel } from "@/components/academic/format";
import { AppText, SegmentedControl } from "@/components/ui";
import { MEMORY_PRIVACY_LINE } from "./memory-privacy";
import { MEMORY_KIND_ORDER, MEMORY_KIND_PRESENTATION } from "./memory-row-state";
import type { MemoryFormValues } from "./memory-form-state";

// The memory editor's fields (Checkpoint 10.7, ADR-077): kind, statement,
// optional note, and the two optional typed links -- a project (the same
// ChoiceChips tasks/[id].tsx draws) and a course (from the academic course
// list, current term by default; a linked course from another term is shown
// as its own selected chip so it can still be cleared). The privacy line
// sits under the form on both screens.
//
// Prop-driven and hookless, like TaskAssignmentPicker: the screens own the
// values, the fetches and the mutation, so this component can be walked by
// a test and shared byte-for-byte by /memory/new and /memory/[id].
//
// Both TextInputs stay literal TextInput elements carrying their maxLength,
// with a `FieldLengthCounter` each: src/__tests__/content-bounds.test.ts
// reads this file's source to pin the bounds to the schema's constants.

export interface MemoryFormProps {
  values: MemoryFormValues;
  onChange: (values: MemoryFormValues) => void;
  projects: readonly { id: string; name: string }[] | undefined;
  courses: readonly AcademicCourseSummary[] | undefined;
  /** A linked course not in `courses` (another term), so it still renders as selected. */
  linkedCourse: { id: string; label: string } | null;
  placeholderColor: string;
  disabled?: boolean;
}

const KIND_OPTIONS = MEMORY_KIND_ORDER.map((kind) => ({
  value: kind,
  label: MEMORY_KIND_PRESENTATION[kind].label,
  testID: `memory-kind-${kind}`,
}));

export function MemoryForm({
  values,
  onChange,
  projects,
  courses,
  linkedCourse,
  placeholderColor,
  disabled = false,
}: MemoryFormProps) {
  const set = <K extends keyof MemoryFormValues>(key: K, value: MemoryFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const courseOptions = courses ?? [];
  const extraCourse =
    linkedCourse && !courseOptions.some((course) => course.id === linkedCourse.id)
      ? linkedCourse
      : null;

  return (
    <View>
      <FieldLabel>Kind</FieldLabel>
      <SegmentedControl<MemoryKind>
        value={values.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => set("kind", kind)}
        className="mb-4"
      />

      <FieldLabel>Statement</FieldLabel>
      <TextInput
        value={values.statement}
        onChangeText={(text) => set("statement", text)}
        multiline
        textAlignVertical="top"
        placeholder="One sentence you want Personal OS to keep"
        placeholderTextColor={placeholderColor}
        // The server's own bound (packages/schema/src/text-bounds.ts), so an
        // over-long paste is stopped here rather than refused as a 400.
        maxLength={MEMORY_STATEMENT_MAX_CHARS}
        editable={!disabled}
        accessibilityLabel="Statement"
        className={textFieldClass({ multiline: true, extra: "mb-4 min-h-[96px]" })}
        testID="memory-statement"
      />
      <FieldLengthCounter length={values.statement.length} maxLength={MEMORY_STATEMENT_MAX_CHARS} />

      <FieldLabel>Note (optional)</FieldLabel>
      <TextInput
        value={values.note}
        onChangeText={(text) => set("note", text)}
        multiline
        textAlignVertical="top"
        placeholder="Why this matters, or any detail"
        placeholderTextColor={placeholderColor}
        maxLength={MEMORY_NOTE_MAX_CHARS}
        editable={!disabled}
        accessibilityLabel="Note"
        className={textFieldClass({ multiline: true, extra: "mb-4 min-h-[72px]" })}
        testID="memory-note"
      />
      <FieldLengthCounter length={values.note.length} maxLength={MEMORY_NOTE_MAX_CHARS} />

      <FieldLabel>Linked to</FieldLabel>
      <AppText variant="caption" tone="muted" className="mb-2">
        Project
      </AppText>
      <View className="mb-3 flex-row flex-wrap gap-2">
        <ChoiceChip
          label="None"
          selected={values.projectId === null}
          disabled={disabled}
          onPress={() => set("projectId", null)}
          accessibilityLabel="No project"
          testID="memory-project-none"
        />
        {(projects ?? []).map((project) => (
          <ChoiceChip
            key={project.id}
            label={project.name}
            selected={values.projectId === project.id}
            disabled={disabled}
            onPress={() => set("projectId", values.projectId === project.id ? null : project.id)}
            accessibilityLabel={`Project: ${project.name}`}
          />
        ))}
      </View>
      <AppText variant="caption" tone="muted" className="mb-2">
        Course
      </AppText>
      <View className="mb-4 flex-row flex-wrap gap-2">
        <ChoiceChip
          label="None"
          selected={values.courseId === null}
          disabled={disabled}
          onPress={() => set("courseId", null)}
          accessibilityLabel="No course"
          testID="memory-course-none"
        />
        {extraCourse ? (
          <ChoiceChip
            label={extraCourse.label}
            selected={values.courseId === extraCourse.id}
            disabled={disabled}
            onPress={() =>
              set("courseId", values.courseId === extraCourse.id ? null : extraCourse.id)
            }
            accessibilityLabel={`Course: ${extraCourse.label}`}
          />
        ) : null}
        {courseOptions.map((course) => (
          <ChoiceChip
            key={course.id}
            label={courseLabel(course.code, course.name)}
            selected={values.courseId === course.id}
            disabled={disabled}
            onPress={() => set("courseId", values.courseId === course.id ? null : course.id)}
            accessibilityLabel={`Course: ${course.name}`}
          />
        ))}
      </View>

      <AppText variant="caption" tone="secondary" className="mb-4" testID="memory-form-privacy">
        {MEMORY_PRIVACY_LINE}
      </AppText>
    </View>
  );
}
