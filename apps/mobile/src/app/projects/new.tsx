import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { useCreateProject } from "@/queries/projects";
import { describeValidationError } from "@/utils/validation-error";
import { ENTITY_TITLE_MAX_CHARS } from "@personal-os/schema";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";

export default function NewProjectScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");

  const submit = () => {
    if (!name.trim()) return;
    createProject.mutate(
      { name: name.trim(), color },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // Padding lives entirely in contentContainerStyle (no
      // contentContainerClassName) because NativeWind remaps that class onto
      // this same prop -- see FLOATING_CLEARANCE_PX. The clearance keeps the
      // globally-mounted QuickAdd/PTT buttons off this form's Save/Archive
      // control; the keyboard height gives room to scroll it clear of the IME.
      // Extra room so lower controls can be scrolled clear of the IME --
      // see components/use-keyboard-height.ts for why insets alone don't do it.
      contentContainerStyle={{ padding: 16, paddingBottom: FLOATING_CLEARANCE_PX + keyboardHeight }}
      // Without this the first tap on a submit button below a focused field
      // only dismisses the keyboard instead of submitting.
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 text-sm text-neutral-500">Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        // The server's own bound (packages/schema/src/text-bounds.ts), so an
        // over-long paste is stopped here rather than refused as a 400.
        maxLength={ENTITY_TITLE_MAX_CHARS}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />
      <FieldLengthCounter length={name.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

      <Text className="mb-1 text-sm text-neutral-500">Color</Text>
      <TextInput
        value={color}
        onChangeText={setColor}
        placeholder="#3b82f6"
        placeholderTextColor={placeholderColor}
        className="mb-4 rounded-lg border border-neutral-300 p-3 text-black dark:border-neutral-700 dark:text-white"
      />

      {createProject.isError ? (
        <Text className="mb-2 text-red-600" accessibilityRole="alert">
          {/* A refused field (client-side parse or a server 400) names the
              field and its bound; anything else keeps the generic line. */}
          {describeValidationError(createProject.error) ?? "Couldn't create that project."}
        </Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={createProject.isPending || !name.trim()}
        className="items-center rounded-lg bg-blue-600 py-3 active:bg-blue-700"
      >
        <Text className="font-semibold text-white">
          {createProject.isPending ? "Saving..." : "Create project"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
