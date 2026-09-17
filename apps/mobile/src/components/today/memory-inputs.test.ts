import type { MemoryItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  MEMORY_ABSENT,
  MEMORY_LOADING,
  memoryIntelligenceInput,
  toMemoryLinkInput,
  toMemoryLinkInputs,
} from "./memory-inputs";

// The pure projection of the two memory queries onto the composers' input
// (Checkpoint 10.7, ADR-077 §5/§7): exactly the five typed-link fields cross,
// and the soft-degradation rule (loading ⇒ not settled and absent; errored or
// switched off ⇒ settled and absent) is decided here as data.

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "preference",
    statement: "I work best in the evening",
    note: "a private note",
    source: "user",
    suggestion_id: null,
    project_id: "44444444-4444-4444-8444-444444444444",
    canvas_course_id: null,
    created_at: "2026-09-16T00:00:00.000Z",
    updated_at: "2026-09-16T00:00:00.000Z",
    project: { id: "44444444-4444-4444-8444-444444444444", name: "Thesis" },
    course: null,
    ...overrides,
  };
}

describe("toMemoryLinkInput", () => {
  it("projects exactly id, kind, statement and the two link ids -- never the note, source, names or timestamps", () => {
    const projected = toMemoryLinkInput(item());
    expect(projected).toEqual({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      kind: "preference",
      statement: "I work best in the evening",
      projectId: "44444444-4444-4444-8444-444444444444",
      canvasCourseId: null,
    });
    expect(Object.keys(projected).sort()).toEqual(
      ["canvasCourseId", "id", "kind", "projectId", "statement"].sort(),
    );
  });

  it("carries a course link and a goal/fact kind through unchanged", () => {
    expect(
      toMemoryLinkInput(
        item({
          kind: "goal",
          project_id: null,
          canvas_course_id: "22222222-2222-4222-8222-222222222222",
        }),
      ),
    ).toMatchObject({
      kind: "goal",
      projectId: null,
      canvasCourseId: "22222222-2222-4222-8222-222222222222",
    });
    expect(toMemoryLinkInput(item({ kind: "fact" })).kind).toBe("fact");
  });

  it("maps a list in order", () => {
    expect(
      toMemoryLinkInputs([item({ id: "a" as never }), item({ id: "b" as never })]).map((m) => m.id),
    ).toEqual(["a", "b"]);
    expect(toMemoryLinkInputs([])).toEqual([]);
  });
});

describe("memoryIntelligenceInput", () => {
  const list = { data: { items: [item()] }, isError: false };
  const on = { data: { enabled: true }, isError: false };
  const off = { data: { enabled: false }, isError: false };
  const loading = { data: undefined, isError: false };
  const errored = { data: undefined, isError: true };

  it("is settled with every memory projected when both queries are in and the switch is on", () => {
    expect(memoryIntelligenceInput(list, on)).toEqual({
      memories: [toMemoryLinkInput(item())],
      memoryEnabled: true,
      settled: true,
    });
  });

  it("is settled and ABSENT when the switch is off -- the composers then match nothing (ADR-077 §7)", () => {
    expect(memoryIntelligenceInput(list, off)).toBe(MEMORY_ABSENT);
    expect(MEMORY_ABSENT).toEqual({ memories: null, memoryEnabled: false, settled: true });
  });

  it("is NOT settled, and absent, while either query is still loading", () => {
    expect(memoryIntelligenceInput(loading, on)).toBe(MEMORY_LOADING);
    expect(memoryIntelligenceInput(list, loading)).toBe(MEMORY_LOADING);
    expect(MEMORY_LOADING).toEqual({ memories: null, memoryEnabled: false, settled: false });
  });

  it("is settled and absent when either query errored, even if the other has data", () => {
    expect(memoryIntelligenceInput(errored, on)).toBe(MEMORY_ABSENT);
    expect(memoryIntelligenceInput(list, errored)).toBe(MEMORY_ABSENT);
    expect(memoryIntelligenceInput(errored, errored)).toBe(MEMORY_ABSENT);
  });

  it("an error wins over a still-loading partner: nothing waits on a source that already failed", () => {
    expect(memoryIntelligenceInput(errored, loading).settled).toBe(true);
    expect(memoryIntelligenceInput(loading, errored).settled).toBe(true);
  });
});
