import { ApiClientError } from "@personal-os/api-client";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { MemoryForm } from "@/components/memory/memory-form";
import {
  EMPTY_MEMORY_FORM,
  buildMemoryUpdate,
  canSaveMemory,
  memoryFormFromItem,
  memoryUsedByCopy,
  type MemoryFormValues,
} from "@/components/memory/memory-form-state";
import { memorySourceLine } from "@/components/memory/memory-row-state";
import { usePlaceholderColor } from "@/components/placeholder-color";
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
  showToast,
} from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { useAcademicCourses } from "@/queries/academic";
import { coerceMemoryIdParam, useDeleteMemory, useMemory, useUpdateMemory } from "@/queries/memory";
import { useProjects } from "@/queries/projects";
import { describeValidationError } from "@/utils/validation-error";

// One memory (Checkpoint 10.7, ADR-077): where it came from (an inert
// provenance row -- `source` is shown, never editable), what it is linked to
// (tappable, the 10.5 "Project: X ›" idiom), the same editor /memory/new
// draws, an honest "Used by" panel, Save, and Delete.
//
// Delete means delete (ADR-077 §2): a real row delete behind
// `confirmDestructive` (which fires the warning haptic itself), with a toast
// that outlives this screen. There is no archive and no undo beyond the
// export the Memory Center points at.

function projectRoute(id: string): Href {
  return `/projects/${encodeURIComponent(id)}` as Href;
}

function courseRoute(id: string): Href {
  return `/academic/${encodeURIComponent(id)}` as Href;
}

/** The course code when it has one, else its name -- the same word the row chip shows. */
function courseDisplayLabel(course: { name: string; course_code: string | null }): string {
  const code = course.course_code?.trim() ?? "";
  return code.length > 0 ? code : course.name;
}

export default function MemoryDetailScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = coerceMemoryIdParam(params.id);
  const { data: memory, isLoading, isError, error, refetch } = useMemory(id);
  const { data: projects } = useProjects();
  const { data: courses } = useAcademicCourses();
  const updateMemory = useUpdateMemory();
  const deleteMemory = useDeleteMemory();

  const [values, setValues] = useState<MemoryFormValues>(EMPTY_MEMORY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (memory) setValues(memoryFormFromItem(memory));
  }, [memory]);

  if (id === null) {
    return (
      <ScreenCentered>
        <ErrorState title="Not found" message="This memory couldn't be found." />
      </ScreenCentered>
    );
  }

  if (isLoading || (!isError && !memory)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={4} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !memory) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={status === 404 ? "This memory couldn't be found." : "Couldn't load this memory."}
          // A 404 is terminal -- the same id answers the same way -- so Retry
          // appears only for a failure that could clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this memory"
        />
      </ScreenCentered>
    );
  }

  const linkedProject = memory.project;
  const linkedCourse = memory.course;
  const linked = linkedProject !== null || linkedCourse !== null;
  const pending = updateMemory.isPending || deleteMemory.isPending;

  const submit = () => {
    setSaveError(null);
    if (!canSaveMemory(values)) return;
    const patch = buildMemoryUpdate(memory, values);
    if (patch === null) {
      router.back();
      return;
    }
    updateMemory.mutate(
      { id: memory.id, body: patch },
      {
        onSuccess: () => {
          showToast({ message: "Saved", tone: "success" });
          router.back();
        },
        // Never the raw message: a refused field names itself and its bound.
        onError: (err) =>
          setSaveError(
            describeValidationError(err) ?? "Couldn't save those changes. Please try again.",
          ),
      },
    );
  };

  const onDelete = () =>
    confirmDestructive({
      title: "Delete this memory?",
      message: "This can't be undone. Export first if you want a copy.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setSaveError(null);
        deleteMemory.mutate(memory.id, {
          onSuccess: () => {
            showToast({ message: "Memory deleted", tone: "danger" });
            router.back();
          },
          onError: () => setSaveError("Couldn't delete this memory. Please try again."),
        });
      },
    });

  return (
    <ScreenFrame>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card padding="none" className="mb-4">
          {/* Provenance is read, never edited: the row that answers "where
              from and since when" (ADR-077 §3). */}
          <ListRow
            icon="account-check-outline"
            iconTone={memory.source === "suggestion" ? "info" : "primary"}
            title={memorySourceLine(memory)}
            subtitle={memory.source === "suggestion" ? "You accepted a suggestion" : undefined}
            accessibilityLabel={`Source: ${memorySourceLine(memory)}${
              memory.source === "suggestion" ? ". You accepted a suggestion" : ""
            }`}
            last={!linked}
            testID="memory-source-row"
          />
          {linkedProject ? (
            <ListRow
              title={`Project: ${linkedProject.name}`}
              onPress={() => router.push(projectRoute(linkedProject.id))}
              accessibilityLabel={`Open project: ${linkedProject.name}`}
              chevron
              last={linkedCourse === null}
              testID="memory-project-link-row"
            />
          ) : null}
          {linkedCourse ? (
            <ListRow
              title={`Course: ${courseDisplayLabel(linkedCourse)}`}
              onPress={() => router.push(courseRoute(linkedCourse.id))}
              accessibilityLabel={`Open course: ${linkedCourse.name}`}
              chevron
              last
              testID="memory-course-link-row"
            />
          ) : null}
        </Card>

        <MemoryForm
          values={values}
          onChange={(next) => {
            setSaveError(null);
            setValues(next);
          }}
          projects={projects}
          courses={courses?.items}
          linkedCourse={
            linkedCourse ? { id: linkedCourse.id, label: courseDisplayLabel(linkedCourse) } : null
          }
          placeholderColor={placeholderColor}
          disabled={pending}
        />

        <Card variant="soft" className="mb-4" accessibilityLabel="Used by">
          <SectionHeader title="Used by" icon="target" spacing="none" className="pb-1" />
          <AppText variant="body" tone="secondary" testID="memory-used-by">
            {memoryUsedByCopy(values.kind, values.projectId !== null || values.courseId !== null)}
          </AppText>
        </Card>

        {saveError ? (
          <AppText
            variant="body"
            tone="danger"
            className="mb-3"
            accessibilityRole="alert"
            testID="memory-save-error"
          >
            {saveError}
          </AppText>
        ) : null}

        <Button
          label="Save changes"
          onPress={submit}
          disabled={!canSaveMemory(values) || deleteMemory.isPending}
          busy={updateMemory.isPending}
          variant="primary"
          icon="content-save-outline"
          block
          className="mb-3"
          testID="memory-save"
        />
        <Button
          label="Delete memory"
          onPress={onDelete}
          disabled={updateMemory.isPending}
          busy={deleteMemory.isPending}
          variant="danger"
          icon="delete-outline"
          block
          testID="memory-delete"
        />
      </ScrollView>
    </ScreenFrame>
  );
}
