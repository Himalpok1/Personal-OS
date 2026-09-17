import { MEMORY_KINDS } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { MEMORY_STARTERS, memoryNewHref, memoryStarterHref } from "./memory-starters";

// The starter chips are prompts, not inferences (ADR-077 §4): a fixed list,
// each opening the editor prefilled -- never a write, never an id.

describe("MEMORY_STARTERS", () => {
  it("is a short fixed list of example sentences with a valid kind each", () => {
    expect(MEMORY_STARTERS.length).toBeGreaterThanOrEqual(3);
    expect(MEMORY_STARTERS.length).toBeLessThanOrEqual(4);
    for (const starter of MEMORY_STARTERS) {
      expect(starter.statement.trim().length).toBeGreaterThan(0);
      expect(MEMORY_KINDS).toContain(starter.kind);
    }
    expect(MEMORY_STARTERS.map((s) => s.statement)).toEqual([
      "I work best in the evening",
      "Short tasks first",
      "Mornings are for classes",
      "Working hours 9-18",
    ]);
  });
});

describe("memoryNewHref", () => {
  it("is the bare editor route with no prefill", () => {
    expect(memoryNewHref()).toBe("/memory/new");
  });

  it("carries the kind alone for a section's Add", () => {
    expect(memoryNewHref({ kind: "goal" })).toBe("/memory/new?kind=goal");
  });

  it("encodes a statement prefill", () => {
    expect(memoryNewHref({ kind: "preference", statement: "Working hours 9-18" })).toBe(
      "/memory/new?kind=preference&statement=Working%20hours%209-18",
    );
  });

  it("a starter opens the editor with its own kind and sentence, only", () => {
    const href = memoryStarterHref(MEMORY_STARTERS[2]!);
    expect(href).toBe("/memory/new?kind=fact&statement=Mornings%20are%20for%20classes");
    expect(href).not.toMatch(/id=/);
  });
});
