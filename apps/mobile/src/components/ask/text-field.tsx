// Text fields (Checkpoint 10.3): a TextInput on a `surface-container` well
// with the `inner` radius. Composed here rather than in components/ui/
// because the design system shipped without a field primitive.
//
// Two shapes, for two constraints in the tests that pin the forms:
//
//   * `textFieldClass()` -- a pure class string for a bare `<TextInput>`.
//     content-bounds.test.ts reads every form screen's SOURCE for literal
//     `<TextInput ... maxLength={...} />` elements, and events-screen.test.tsx
//     counts `TextInput` elements in an UNEXPANDED tree, so those inputs must
//     stay `TextInput` elements in the screen itself -- only their classes can
//     come from here. The colour vocabulary therefore lives in this one file,
//     not in each screen.
//   * `TextField` -- the well as a row, for a field with a leading icon and a
//     trailing control (the search box). The screen tests that read it walk
//     through function components, so the wrapper is transparent to them.
import type { ReactNode } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { AppText, Icon, useTheme, type IconName } from "@/components/ui";

const WELL_CLASS = "rounded-inner bg-surface-container dark:bg-surface-container-dark";
const INPUT_TEXT_CLASS = "text-body text-on-surface dark:text-on-surface-dark";

/** The classes for a stand-alone `<TextInput>` on a well. */
export function textFieldClass(options: { multiline?: boolean; extra?: string } = {}): string {
  return [
    WELL_CLASS,
    INPUT_TEXT_CLASS,
    "px-4 py-3",
    options.multiline ? "min-h-[120px]" : "min-h-[48px]",
    options.extra,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The same well for a pressable field that is not a TextInput (a date picker's trigger). */
export function fieldWellClass(extra?: string): string {
  return [WELL_CLASS, "min-h-[48px] justify-center px-4", extra].filter(Boolean).join(" ");
}

/** The label above a form field: one line, secondary tone, the same everywhere. */
export function FieldLabel({ children, className }: { children: string; className?: string }) {
  return (
    <AppText
      variant="label"
      tone="secondary"
      className={["mb-1", className].filter(Boolean).join(" ")}
    >
      {children}
    </AppText>
  );
}

export interface TextFieldProps extends Omit<TextInputProps, "className"> {
  leadingIcon?: IconName;
  /** A control after the input (a clear button); the caller sizes it. */
  trailing?: ReactNode;
  /** Layout-only classes on the well. */
  className?: string;
}

export function TextField({ leadingIcon, trailing, className, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View
      className={[
        WELL_CLASS,
        "flex-row items-center",
        leadingIcon ? "pl-3" : "",
        trailing ? "pr-1" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {leadingIcon ? <Icon name={leadingIcon} size="md" tone="on-surface-muted" /> : null}
      <TextInput
        {...input}
        placeholderTextColor={input.placeholderTextColor ?? colors.placeholder}
        className={`min-h-[48px] flex-1 px-3 py-3 ${INPUT_TEXT_CLASS}`}
      />
      {trailing ?? null}
    </View>
  );
}
