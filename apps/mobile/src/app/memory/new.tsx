import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { MemoryForm } from "@/components/memory/memory-form";
import {
  EMPTY_MEMORY_FORM,
  buildMemoryCreate,
  canSaveMemory,
  coerceMemoryKindParam,
  coerceStatementParam,
  type MemoryFormValues,
} from "@/components/memory/memory-form-state";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { AppText, Button, ScreenFrame, showToast } from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useAcademicCourses } from "@/queries/academic";
import { useCreateMemory } from "@/queries/memory";
import { useProjects } from "@/queries/projects";
import { describeValidationError } from "@/utils/validation-error";

// A new memory (Checkpoint 10.7, ADR-077 §3): the owner types one sentence,
// picks its kind, optionally links a project and/or a course, and saves.
// `?kind=` and `?statement=` prefill the form (the Memory Center's "Add" per
// section and its starter chips); nothing is written until Save.
//
// Save is the only write, `source` is never sent (the server writes `user`),
// and a refused field -- an over-bound paste, an unknown link id -- lands in
// the inline banner through describeValidationError, never the raw message.

export default function NewMemoryScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; statement?: string }>();
  const createMemory = useCreateMemory();
  const { data: projects } = useProjects();
  const { data: courses } = useAcademicCourses();

  const [values, setValues] = useState<MemoryFormValues>(() => ({
    ...EMPTY_MEMORY_FORM,
    kind: coerceMemoryKindParam(params.kind),
    statement: coerceStatementParam(params.statement),
  }));

  const submit = () => {
    if (!canSaveMemory(values)) return;
    createMemory.mutate(buildMemoryCreate(values), {
      onSuccess: () => {
        showToast({ message: "Remembered", tone: "success" });
        router.back();
      },
    });
  };

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        // Padding lives in contentContainerStyle (NativeWind remaps the class
        // form onto this prop -- see FLOATING_CLEARANCE_PX); the keyboard
        // height gives room to scroll Save clear of the IME.
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <MemoryForm
          values={values}
          onChange={setValues}
          projects={projects}
          courses={courses?.items}
          linkedCourse={null}
          placeholderColor={placeholderColor}
          disabled={createMemory.isPending}
        />

        {createMemory.isError ? (
          <AppText
            variant="body"
            tone="danger"
            className="mb-3"
            accessibilityRole="alert"
            testID="memory-save-error"
          >
            {describeValidationError(createMemory.error) ??
              "Couldn't save that memory. Please try again."}
          </AppText>
        ) : null}

        <Button
          label="Save"
          onPress={submit}
          disabled={!canSaveMemory(values)}
          busy={createMemory.isPending}
          variant="primary"
          icon="content-save-outline"
          block
          testID="memory-save"
        />
      </ScrollView>
    </ScreenFrame>
  );
}
