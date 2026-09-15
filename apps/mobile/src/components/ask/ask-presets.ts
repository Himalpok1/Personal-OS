import { ASK_PRESET_QUESTIONS, askPresetForQuestion, type AskPreset } from "@personal-os/schema";

// The three "Ask about today" preset chips (Checkpoint 9.7).
//
// The QUESTION strings are the schema's `ASK_PRESET_QUESTIONS` -- ONE
// definition shared with the API, which matches the submitted question
// byte-for-byte to pick the Today section its drop ladder must never empty.
// Only the chip LABEL is authored here. A preset is still an explicit tap:
// nothing here submits anything (see app/search/index.tsx), and a preset
// always goes out with `scope: "today"`, so no note or task body ever leaves
// for one.

export interface AskPresetDefinition {
  key: AskPreset;
  /** The chip text, sized for a 480px row. */
  label: string;
  /** The exact question submitted -- byte-equal to the server's table. */
  question: string;
}

export const ASK_PRESETS: readonly AskPresetDefinition[] = [
  { key: "focus", label: "What should I focus on?", question: ASK_PRESET_QUESTIONS.focus },
  { key: "slipping", label: "What's slipping?", question: ASK_PRESET_QUESTIONS.slipping },
  { key: "tomorrow", label: "Summarize tomorrow", question: ASK_PRESET_QUESTIONS.tomorrow },
];

/** The preset whose `key` matches, or null for an unknown/absent route param. */
export function findAskPreset(key: string | string[] | undefined): AskPresetDefinition | null {
  if (typeof key !== "string") return null;
  return ASK_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * Whether a question, as it will be submitted, IS a preset. Derived from the
 * text rather than held as separate state: a chip is "selected" exactly when
 * the input holds its question, and editing a single character turns the
 * submission back into free text (`scope: "both"`). Delegates to the schema's
 * own matcher so the client and the server agree on what counts.
 */
export function askPresetOf(question: string): AskPresetDefinition | null {
  const key = askPresetForQuestion(question);
  return key === null ? null : (ASK_PRESETS.find((preset) => preset.key === key) ?? null);
}
