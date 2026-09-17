import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  AppText,
  Button,
  ErrorState,
  ScreenCentered,
  ScreenFrame,
  SkeletonCard,
} from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { useProjects } from "@/queries/projects";
import { useArchiveNote, useNote, useUpdateNote } from "@/queries/notes";
import { describeValidationError } from "@/utils/validation-error";
import { ApiClientError } from "@personal-os/api-client";
import { ENTITY_TITLE_MAX_CHARS, NOTE_BODY_MAX_CHARS } from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

export default function EditNoteScreen() {
  const keyboardHeight = useKeyboardHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: note, isLoading, isError, error, refetch } = useNote(id);
  const { data: projects } = useProjects();
  const updateNote = useUpdateNote();
  const archiveNote = useArchiveNote();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  // Save failures (Checkpoint 9.6). Until now `updateNote.mutate` had no
  // onError at all, so a refused save -- an over-bound body, say -- left the
  // form exactly as it was with nothing to say why.
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setBody(note.body);
    setProjectId(note.project_id ?? undefined);
  }, [note]);

  if (isLoading || (!isError && !note)) {
    return (
      <ScreenFrame>
        <View className="px-4 pt-4">
          <SkeletonCard lines={5} />
        </View>
      </ScreenFrame>
    );
  }

  if (isError || !note) {
    const status = error instanceof ApiClientError ? error.status : null;
    return (
      <ScreenCentered>
        <ErrorState
          title={status === 404 ? "Not found" : "Something went wrong"}
          message={status === 404 ? "This note couldn't be found." : "Couldn't load this note."}
          // A 404 is terminal -- refetching the same id repeats the same
          // answer -- so the affordance appears only for a failure that could
          // actually clear.
          onRetry={status === 404 ? undefined : () => void refetch()}
          retryAccessibilityLabel="Retry loading this note"
        />
      </ScreenCentered>
    );
  }

  const submit = () => {
    setSaveError(null);
    updateNote.mutate(
      {
        id: note.id,
        body: { title: title.trim() || undefined, body: body.trim() || undefined, project_id: projectId ?? null },
      },
      {
        // A refused field -- a server 400 or the api-client's own pre-request
        // parse (a raw ZodError) -- names the field and its bound. Never the
        // raw message: `ApiClientError.message` is developer-shaped.
        onError: (err) =>
          setSaveError(
            describeValidationError(err) ??
              (err instanceof ApiClientError && err.status === 404
                ? "This note couldn't be found."
                : "Couldn't save those changes. Please try again."),
          ),
      },
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
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Title"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={title.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        <FieldLabel>Body</FieldLabel>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
          maxLength={NOTE_BODY_MAX_CHARS}
          accessibilityLabel="Body"
          className={textFieldClass({ multiline: true, extra: "mb-4 min-h-[160px]" })}
        />
        <FieldLengthCounter length={body.length} maxLength={NOTE_BODY_MAX_CHARS} />

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

        {saveError ? (
          <AppText variant="body" tone="danger" className="mb-2" accessibilityRole="alert">
            {saveError}
          </AppText>
        ) : null}

        <Button
          label={updateNote.isPending ? "Saving..." : "Save changes"}
          onPress={submit}
          disabled={updateNote.isPending}
          variant="primary"
          icon="content-save-outline"
          block
          className="mb-3"
        />

        <Button
          label={archiveNote.isPending ? "Archiving..." : "Archive note"}
          onPress={() =>
            confirmDestructive({
              title: "Archive this note?",
              message:
                "This hides it from your lists. There's currently no way to view or restore it from the app.",
              confirmLabel: "Archive",
              onConfirm: () => archiveNote.mutate(note.id, { onSuccess: () => router.back() }),
            })
          }
          disabled={archiveNote.isPending}
          variant="danger"
          icon="archive-arrow-down-outline"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
