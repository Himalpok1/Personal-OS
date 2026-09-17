import { ChoiceChip } from "@/components/ask/choice-chip";
import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { AppText, Button, ScreenFrame } from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { coerceProjectIdParam, useProjects } from "@/queries/projects";
import { useCreateNote } from "@/queries/notes";
import { describeValidationError } from "@/utils/validation-error";
import { ENTITY_TITLE_MAX_CHARS, NOTE_BODY_MAX_CHARS } from "@personal-os/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

export default function NewNoteScreen() {
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const createNote = useCreateNote();
  const { data: projects } = useProjects();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Preselected via /notes/new?projectId=<uuid> (project detail "+ Note").
  const [projectId, setProjectId] = useState<string | undefined>(() =>
    coerceProjectIdParam(params.projectId),
  );

  const submit = () => {
    if (!title.trim() || !body.trim()) return;
    createNote.mutate(
      { title: title.trim(), body: body.trim(), project_id: projectId },
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
          className={textFieldClass({ multiline: true, extra: "mb-4" })}
        />
        <FieldLengthCounter length={body.length} maxLength={NOTE_BODY_MAX_CHARS} />

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

        {createNote.isError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {/* A refused field (client-side parse or a server 400) names the
                field and its bound; anything else keeps the generic line. */}
            {describeValidationError(createNote.error) ?? "Couldn't create that note."}
          </AppText>
        ) : null}

        <Button
          label={createNote.isPending ? "Saving..." : "Create note"}
          onPress={submit}
          // `disabled`, not `busy`: the pending label has always read
          // "Saving...", which `busy` would render as "Create …".
          disabled={createNote.isPending || !title.trim() || !body.trim()}
          variant="primary"
          icon="plus"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
