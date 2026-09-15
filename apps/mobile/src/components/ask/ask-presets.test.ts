import { ASK_PRESET_QUESTIONS, AskPresetSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { ASK_PRESETS, askPresetOf, findAskPreset } from "./ask-presets";

describe("ASK_PRESETS", () => {
  it("submits EXACTLY the questions the server matches on, one chip per preset, in order", () => {
    // The server picks the protected Today section by matching the question
    // text byte-for-byte; a drifted string here would silently turn a preset
    // into free text with `scope: "both"`.
    expect(ASK_PRESETS.map((p) => p.key)).toEqual(AskPresetSchema.options);
    expect(ASK_PRESETS.map((p) => p.question)).toEqual([
      "What should I focus on today?",
      "What's slipping?",
      "Summarize tomorrow",
    ]);
    for (const preset of ASK_PRESETS) {
      expect(preset.question).toBe(ASK_PRESET_QUESTIONS[preset.key]);
    }
  });

  it("labels are the chip copy", () => {
    expect(ASK_PRESETS.map((p) => p.label)).toEqual([
      "What should I focus on?",
      "What's slipping?",
      "Summarize tomorrow",
    ]);
  });
});

describe("findAskPreset -- the route param", () => {
  it("resolves a known key", () => {
    expect(findAskPreset("focus")?.key).toBe("focus");
    expect(findAskPreset("tomorrow")?.question).toBe("Summarize tomorrow");
  });

  it("is null for an absent, unknown, or array-valued param -- never a guess", () => {
    expect(findAskPreset(undefined)).toBeNull();
    expect(findAskPreset("")).toBeNull();
    expect(findAskPreset("FOCUS")).toBeNull();
    expect(findAskPreset("settings")).toBeNull();
    expect(findAskPreset(["focus"])).toBeNull();
  });
});

describe("askPresetOf -- the question text decides", () => {
  it("matches a preset question byte-for-byte", () => {
    expect(askPresetOf("What's slipping?")?.key).toBe("slipping");
  });

  it("is null for free text, a near miss, or a case change", () => {
    expect(askPresetOf("what's slipping?")).toBeNull();
    expect(askPresetOf("What's slipping")).toBeNull();
    expect(askPresetOf("What's slipping? and why")).toBeNull();
    expect(askPresetOf("")).toBeNull();
  });
});
