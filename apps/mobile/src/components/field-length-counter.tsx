import { AppText } from "@/components/ui";

// A live "3,900 / 4,000" under a bounded TextInput (Checkpoint 9.6).
//
// Every user text field now carries `maxLength` equal to the server's own
// constant (packages/schema/src/text-bounds.ts), so the input itself stops
// accepting characters at the bound -- silently. On a 480 px Rabbit screen a
// permanent counter under every field is noise, so this renders NOTHING
// until the text is within the last tenth of its allowance, and then one
// small right-aligned line. The threshold is inclusive at exactly 90 % so a
// field with a small bound (512) shows the counter from 461 characters.
//
// Hookless (like every *-state.ts-backed view here) so the existing
// render-walk tests can expand it as a plain function.
//
// Deliberately NOT an accessibility live region: a polite live region on a
// counter that changes on every keystroke has TalkBack read "3,601 of 4,000"
// over every character typed past 90 %. The input's own `maxLength` already
// stops accepting text at the bound, and a screen-reader user reaches the
// counter by swiping to it.

/** Fraction of the bound below which the counter stays hidden. */
export const FIELD_LENGTH_COUNTER_THRESHOLD = 0.9;

const formatter = new Intl.NumberFormat("en-US");

/** "3,900 / 4,000", or null while the field is comfortably under its bound. */
export function fieldLengthCounterLabel(length: number, maxLength: number): string | null {
  if (!(maxLength > 0)) return null;
  if (length < Math.ceil(maxLength * FIELD_LENGTH_COUNTER_THRESHOLD)) return null;
  return `${formatter.format(length)} / ${formatter.format(maxLength)}`;
}

/**
 * The default placement: the inputs it follows carry `mb-4`, so the counter
 * is pulled up into that gap and reads as part of the field, not a new row.
 * A caller whose input has no bottom margin passes its own `className`.
 */
export const FIELD_LENGTH_COUNTER_CLASS = "-mt-3 mb-4 text-right";

export function FieldLengthCounter(props: {
  length: number;
  maxLength: number;
  testID?: string;
  className?: string;
}) {
  const label = fieldLengthCounterLabel(props.length, props.maxLength);
  if (label === null) return null;
  return (
    <AppText
      testID={props.testID}
      variant="caption"
      tone="muted"
      className={props.className ?? FIELD_LENGTH_COUNTER_CLASS}
    >
      {label}
    </AppText>
  );
}
