import { describe, expect, it } from "vitest";
import { computeConfidence, type ConfidenceSignals } from "./parse-confidence.js";

const NO_SIGNALS: ConfidenceSignals = {
  typeAmbiguous: false,
  unresolvedDatePhrase: false,
  recurrenceInferred: false,
  degenerateTitle: false,
  unknownProjectReference: false,
  lowTranscriptionConfidence: false,
};

describe("computeConfidence", () => {
  it("is high confidence when no signals fire", () => {
    expect(computeConfidence(NO_SIGNALS).level).toBe("high");
  });

  it.each(["typeAmbiguous", "unresolvedDatePhrase", "recurrenceInferred"] as const)(
    "routes to needs_confirm on the hard signal %s alone",
    (signal) => {
      const result = computeConfidence({ ...NO_SIGNALS, [signal]: true });
      expect(result.level).toBe("needs_confirm");
      expect(result.flags).toEqual([signal]);
    },
  );

  it.each(["degenerateTitle", "unknownProjectReference", "lowTranscriptionConfidence"] as const)(
    "stays high confidence on a single soft signal %s alone",
    (signal) => {
      expect(computeConfidence({ ...NO_SIGNALS, [signal]: true }).level).toBe("high");
    },
  );

  it("routes to needs_confirm when two soft signals fire together", () => {
    const result = computeConfidence({
      ...NO_SIGNALS,
      degenerateTitle: true,
      unknownProjectReference: true,
    });
    expect(result.level).toBe("needs_confirm");
    expect(result.flags).toEqual(["degenerateTitle", "unknownProjectReference"]);
  });

  it("reports every fired flag, not just the first", () => {
    const result = computeConfidence({
      ...NO_SIGNALS,
      typeAmbiguous: true,
      degenerateTitle: true,
      lowTranscriptionConfidence: true,
    });
    expect(result.flags).toEqual([
      "typeAmbiguous",
      "degenerateTitle",
      "lowTranscriptionConfidence",
    ]);
  });
});
