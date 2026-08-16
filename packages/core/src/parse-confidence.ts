// Implements docs/ARCHITECTURE.md's "any hard flag, or two soft flags"
// confidence rule. Kept pure (no LLM/DB access) so it's testable without
// mocking a provider -- the worker job is responsible for gathering these
// signals and feeding them in.
export interface ConfidenceSignals {
  /** The model wavered between task/note/event across two temp-0.3 samples. */
  typeAmbiguous: boolean;
  /** Text contains an unresolved relative-date phrase ("next Thursday")
   * with no due_at/start resolved. */
  unresolvedDatePhrase: boolean;
  /** A recurrence rule was inferred at all -- always confirm the first
   * time, since a wrong RRULE generates wrong occurrences indefinitely. */
  recurrenceInferred: boolean;
  /** Title is empty, under three characters, or just a verb. */
  degenerateTitle: boolean;
  /** A project name reference matched no existing project. */
  unknownProjectReference: boolean;
  /** Capture originated from PTT/voice with low STT confidence. */
  lowTranscriptionConfidence: boolean;
}

export type ConfidenceLevel = "high" | "needs_confirm";

export interface ConfidenceResult {
  level: ConfidenceLevel;
  flags: (keyof ConfidenceSignals)[];
}

const HARD_SIGNALS = [
  "typeAmbiguous",
  "unresolvedDatePhrase",
  "recurrenceInferred",
] as const satisfies readonly (keyof ConfidenceSignals)[];
const SOFT_SIGNALS = [
  "degenerateTitle",
  "unknownProjectReference",
  "lowTranscriptionConfidence",
] as const satisfies readonly (keyof ConfidenceSignals)[];

export function computeConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const flags: (keyof ConfidenceSignals)[] = [];
  let hardCount = 0;
  let softCount = 0;

  for (const key of HARD_SIGNALS) {
    if (signals[key]) {
      hardCount += 1;
      flags.push(key);
    }
  }
  for (const key of SOFT_SIGNALS) {
    if (signals[key]) {
      softCount += 1;
      flags.push(key);
    }
  }

  const level: ConfidenceLevel = hardCount >= 1 || softCount >= 2 ? "needs_confirm" : "high";
  return { level, flags };
}
