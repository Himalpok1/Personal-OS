import { describe, expect, it } from "vitest";
import {
  LOW_TRANSCRIPTION_AVG_LOGPROB,
  isLowTranscriptionConfidence,
} from "./transcription-confidence.js";

describe("isLowTranscriptionConfidence", () => {
  it("flags a PTT transcript below the conservative threshold", () => {
    expect(isLowTranscriptionConfidence("ptt", LOW_TRANSCRIPTION_AVG_LOGPROB - 0.01)).toBe(true);
  });

  it("does not flag the threshold itself or a stronger transcript", () => {
    expect(isLowTranscriptionConfidence("ptt", LOW_TRANSCRIPTION_AVG_LOGPROB)).toBe(false);
    expect(isLowTranscriptionConfidence("ptt", -0.1)).toBe(false);
  });

  it("does not treat missing provider confidence as automatically low", () => {
    expect(isLowTranscriptionConfidence("ptt", null)).toBe(false);
  });

  it("never applies transcription confidence to text capture sources", () => {
    expect(isLowTranscriptionConfidence("web", -2)).toBe(false);
  });
});
