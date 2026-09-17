import type { MemoryItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMORY_FORM,
  buildMemoryCreate,
  buildMemoryUpdate,
  canSaveMemory,
  coerceMemoryKindParam,
  coerceStatementParam,
  memoryExportUrl,
  memoryFormFromItem,
  memoryUsedByCopy,
} from "./memory-form-state";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const COURSE_ID = "33333333-3333-4333-8333-333333333333";

function memory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "preference",
    statement: "I work best in the evening",
    note: null,
    source: "user",
    suggestion_id: null,
    project_id: null,
    canvas_course_id: null,
    created_at: "2026-09-17T12:00:00.000Z",
    updated_at: "2026-09-17T12:00:00.000Z",
    project: null,
    course: null,
    ...overrides,
  };
}

describe("route params", () => {
  it("accepts only the three kinds, defaulting to preference", () => {
    expect(coerceMemoryKindParam("goal")).toBe("goal");
    expect(coerceMemoryKindParam("fact")).toBe("fact");
    expect(coerceMemoryKindParam("habit")).toBe("preference");
    expect(coerceMemoryKindParam(undefined)).toBe("preference");
    expect(coerceMemoryKindParam(["goal"])).toBe("preference");
  });

  it("trims a statement prefill and ignores a non-string", () => {
    expect(coerceStatementParam("  Short tasks first ")).toBe("Short tasks first");
    expect(coerceStatementParam(undefined)).toBe("");
    expect(coerceStatementParam(["x"])).toBe("");
  });
});

describe("the form", () => {
  it("opens a loaded memory with its own values", () => {
    expect(
      memoryFormFromItem(
        memory({ kind: "goal", note: "why", project_id: PROJECT_ID, canvas_course_id: COURSE_ID }),
      ),
    ).toEqual({
      kind: "goal",
      statement: "I work best in the evening",
      note: "why",
      projectId: PROJECT_ID,
      courseId: COURSE_ID,
    });
  });

  it("can save only once the statement has a non-blank character", () => {
    expect(canSaveMemory(EMPTY_MEMORY_FORM)).toBe(false);
    expect(canSaveMemory({ statement: "   " })).toBe(false);
    expect(canSaveMemory({ statement: " x " })).toBe(true);
  });
});

describe("buildMemoryCreate", () => {
  it("sends kind and the trimmed statement, and nothing optional that is empty", () => {
    expect(buildMemoryCreate({ ...EMPTY_MEMORY_FORM, statement: "  Evenings  " })).toEqual({
      kind: "preference",
      statement: "Evenings",
    });
  });

  it("carries the note and both links when set, and never a source", () => {
    const body = buildMemoryCreate({
      kind: "goal",
      statement: "Finish",
      note: " because ",
      projectId: PROJECT_ID,
      courseId: COURSE_ID,
    });
    expect(body).toEqual({
      kind: "goal",
      statement: "Finish",
      note: "because",
      project_id: PROJECT_ID,
      canvas_course_id: COURSE_ID,
    });
    expect("source" in body).toBe(false);
  });
});

describe("buildMemoryUpdate", () => {
  it("is null when nothing changed", () => {
    const loaded = memory({ note: "why", project_id: PROJECT_ID });
    expect(buildMemoryUpdate(loaded, memoryFormFromItem(loaded))).toBeNull();
  });

  it("sends only the changed fields, clearing with null", () => {
    const loaded = memory({ note: "why", project_id: PROJECT_ID, canvas_course_id: COURSE_ID });
    expect(
      buildMemoryUpdate(loaded, {
        ...memoryFormFromItem(loaded),
        kind: "fact",
        note: "",
        projectId: null,
      }),
    ).toEqual({ kind: "fact", note: null, project_id: null });
  });

  it("never carries source or suggestion_id", () => {
    const loaded = memory({ source: "suggestion" });
    const patch = buildMemoryUpdate(loaded, { ...memoryFormFromItem(loaded), statement: "New" });
    expect(patch).toEqual({ statement: "New" });
  });
});

describe("the Used by copy", () => {
  it("names the one reason each linkable kind can earn", () => {
    expect(memoryUsedByCopy("preference", true)).toBe(
      "Focus Now can cite this as 'Matches your preference' when an item is linked to the same project or course.",
    );
    expect(memoryUsedByCopy("goal", true)).toBe(
      "Focus Now can cite this as 'Supports a goal' when an item is linked to the same project or course.",
    );
  });

  it("says how to make that possible when the row is not linked", () => {
    expect(memoryUsedByCopy("goal", false)).toMatch(
      /Link it to a project or course to make that possible\.$/,
    );
  });

  it("is honest that facts are not scored", () => {
    expect(memoryUsedByCopy("fact", true)).toBe(
      "Facts are kept for you to read. Focus Now doesn't score them.",
    );
    expect(memoryUsedByCopy("fact", false)).toBe(memoryUsedByCopy("fact", true));
  });
});

describe("the export url", () => {
  it("is /export on the configured API origin, trailing slash or not", () => {
    expect(memoryExportUrl("https://personal-os.tail62a68f.ts.net")).toBe(
      "https://personal-os.tail62a68f.ts.net/export",
    );
    expect(memoryExportUrl("http://localhost:3000/")).toBe("http://localhost:3000/export");
  });
});
