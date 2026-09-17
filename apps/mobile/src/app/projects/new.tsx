import { FieldLabel, textFieldClass } from "@/components/ask/text-field";
import { AppText, Button, ScreenFrame, tokens } from "@/components/ui";
import { useKeyboardHeight } from "@/components/use-keyboard-height";
import { FLOATING_CLEARANCE_PX } from "@/components/floating-layout";
import { usePlaceholderColor } from "@/components/placeholder-color";
import { FieldLengthCounter } from "@/components/field-length-counter";
import { useCreateProject } from "@/queries/projects";
import { describeValidationError } from "@/utils/validation-error";
import { ENTITY_TITLE_MAX_CHARS } from "@personal-os/schema";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

const DEFAULT_PROJECT_COLOR = tokens.colors.primary.DEFAULT;

export default function NewProjectScreen() {
  const keyboardHeight = useKeyboardHeight();
  const placeholderColor = usePlaceholderColor();
  const router = useRouter();
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  // The default swatch is the palette's own primary (Checkpoint 10.6), read
  // from the light-scheme token rather than the live scheme so the colour a
  // project is SAVED with does not depend on the mode the form was opened in.
  // It stays a field the owner can overwrite with any colour string.
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);

  const submit = () => {
    if (!name.trim()) return;
    createProject.mutate(
      { name: name.trim(), color },
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
        <FieldLabel>Name</FieldLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          // The server's own bound (packages/schema/src/text-bounds.ts), so an
          // over-long paste is stopped here rather than refused as a 400.
          maxLength={ENTITY_TITLE_MAX_CHARS}
          accessibilityLabel="Name"
          className={textFieldClass({ extra: "mb-4" })}
        />
        <FieldLengthCounter length={name.length} maxLength={ENTITY_TITLE_MAX_CHARS} />

        <FieldLabel>Color</FieldLabel>
        <View className="mb-4 flex-row items-center gap-3">
          {/* The swatch previews whatever the field holds; the value is the
              owner's own string, never interpreted beyond being a colour. */}
          <View className="h-6 w-6 rounded-full" style={{ backgroundColor: color }} />
          <TextInput
            value={color}
            onChangeText={setColor}
            placeholder={DEFAULT_PROJECT_COLOR}
            placeholderTextColor={placeholderColor}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Color"
            className={textFieldClass({ extra: "flex-1" })}
          />
        </View>

        {createProject.isError ? (
          <AppText variant="caption" tone="danger" className="mb-2" accessibilityRole="alert">
            {/* A refused field (client-side parse or a server 400) names the
                field and its bound; anything else keeps the generic line. */}
            {describeValidationError(createProject.error) ?? "Couldn't create that project."}
          </AppText>
        ) : null}

        <Button
          label={createProject.isPending ? "Saving..." : "Create project"}
          onPress={submit}
          // `disabled`, not `busy`: the pending label has always read
          // "Saving...", which `busy` would render as "Create …".
          disabled={createProject.isPending || !name.trim()}
          variant="primary"
          icon="plus"
          block
        />
      </ScrollView>
    </ScreenFrame>
  );
}
