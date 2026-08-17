// Whisper-compatible verbose transcription responses report negative mean
// log probabilities: values closer to zero are more confident. The MVP
// starts conservatively and routes clearly weak PTT transcripts through
// confirmation instead of silently committing them.
export const LOW_TRANSCRIPTION_AVG_LOGPROB = -0.8;

export function isLowTranscriptionConfidence(source: string, avgLogprob: number | null): boolean {
  return source === "ptt" && avgLogprob !== null && avgLogprob < LOW_TRANSCRIPTION_AVG_LOGPROB;
}
