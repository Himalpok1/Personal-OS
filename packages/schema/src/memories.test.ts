import { describe, expect, it } from "vitest";
import { ExportResponseSchema } from "./export.js";
import {
  MEMORY_KINDS,
  MEMORY_SOURCES,
  MEMORY_SUGGESTION_KINDS,
  MemoryCreateSchema,
  MemoryItemSchema,
  MemorySchema,
  MemorySuggestionDecideRequestSchema,
  MemorySuggestionSchema,
  MemoryUpdateSchema,
  memorySuggestionKey,
} from "./memories.js";
import { MEMORY_NOTE_MAX_CHARS, MEMORY_STATEMENT_MAX_CHARS } from "./text-bounds.js";

const UUID = "7c2a5e3e-9b35-4b0d-8a4a-1d3d3f8f0a11";
const NOW = "2026-09-17T12:00:00.000Z";

const row = {
  id: UUID,
  kind: "preference",
  statement: "I work best in the evening",
  note: null,
  source: "user",
  suggestion_id: null,
  project_id: null,
  canvas_course_id: null,
  created_at: NOW,
  updated_at: NOW,
};

describe("memory vocabularies are closed and match the CHECK constraints in packages/db", () => {
  it("pins kind, source and suggestion kind exactly", () => {
    expect(MEMORY_KINDS).toEqual(["preference", "goal", "fact"]);
    expect(MEMORY_SOURCES).toEqual(["user", "suggestion"]);
    expect(MEMORY_SUGGESTION_KINDS).toEqual(["project_goal"]);
  });
});

describe("MemorySchema / MemoryItemSchema", () => {
  it("parses a stored row and rejects an unknown key (strict)", () => {
    expect(MemorySchema.safeParse(row).success).toBe(true);
    expect(MemorySchema.safeParse({ ...row, embedding: [0.1] }).success).toBe(false);
    expect(MemorySchema.safeParse({ ...row, confidence: 0.9 }).success).toBe(false);
  });

  it("the item shape adds ONLY the resolved project/course names", () => {
    const item = { ...row, project: { id: UUID, name: "Thesis" }, course: null };
    expect(MemoryItemSchema.safeParse(item).success).toBe(true);
    expect(
      MemoryItemSchema.safeParse({
        ...item,
        project: { id: UUID, name: "Thesis", goal: "leaks the goal" },
      }).success,
    ).toBe(false);
  });
});

describe("MemoryCreateSchema (user-typed text is REJECTED over the bound, ADR-065)", () => {
  it("trims and requires a non-empty statement", () => {
    expect(MemoryCreateSchema.safeParse({ kind: "fact", statement: "   " }).success).toBe(false);
    const parsed = MemoryCreateSchema.parse({ kind: "fact", statement: "  My name is Himal  " });
    expect(parsed.statement).toBe("My name is Himal");
  });

  it("rejects over-long statement and note with the shared field-naming message", () => {
    const tooLong = MemoryCreateSchema.safeParse({
      kind: "goal",
      statement: "x".repeat(MEMORY_STATEMENT_MAX_CHARS + 1),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]?.message).toBe(
        `statement must be at most ${MEMORY_STATEMENT_MAX_CHARS} characters`,
      );
    }
    expect(
      MemoryCreateSchema.safeParse({
        kind: "goal",
        statement: "ok",
        note: "y".repeat(MEMORY_NOTE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(
      MemoryCreateSchema.safeParse({
        kind: "goal",
        statement: "x".repeat(MEMORY_STATEMENT_MAX_CHARS),
        note: "y".repeat(MEMORY_NOTE_MAX_CHARS),
      }).success,
    ).toBe(true);
  });

  it("never accepts client-supplied provenance", () => {
    expect(
      MemoryCreateSchema.safeParse({ kind: "fact", statement: "x", source: "suggestion" }).success,
    ).toBe(false);
    expect(
      MemoryCreateSchema.safeParse({ kind: "fact", statement: "x", suggestion_id: UUID }).success,
    ).toBe(false);
  });
});

describe("MemoryUpdateSchema", () => {
  it("requires at least one field and forbids provenance edits", () => {
    expect(MemoryUpdateSchema.safeParse({}).success).toBe(false);
    expect(MemoryUpdateSchema.safeParse({ note: null }).success).toBe(true);
    expect(MemoryUpdateSchema.safeParse({ project_id: null }).success).toBe(true);
    expect(MemoryUpdateSchema.safeParse({ source: "user" }).success).toBe(false);
    expect(MemoryUpdateSchema.safeParse({ suggestion_id: null }).success).toBe(false);
  });
});

describe("suggestions", () => {
  it("builds a deterministic key", () => {
    expect(memorySuggestionKey("project_goal", UUID)).toBe(`project_goal:${UUID}`);
  });

  it("a pending suggestion carries statement, evidence and the linked project only", () => {
    const suggestion = {
      key: `project_goal:${UUID}`,
      kind: "project_goal",
      memory_kind: "goal",
      statement: "Finish the thesis by December",
      evidence: "From the goal you set on Thesis",
      project: { id: UUID, name: "Thesis" },
    };
    expect(MemorySuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(MemorySuggestionSchema.safeParse({ ...suggestion, confidence: 1 }).success).toBe(false);
  });

  it("remember requires the confirmed statement; not_now/never carry nothing", () => {
    expect(MemorySuggestionDecideRequestSchema.safeParse({ decision: "remember" }).success).toBe(
      false,
    );
    expect(
      MemorySuggestionDecideRequestSchema.safeParse({ decision: "remember", statement: "ok" })
        .success,
    ).toBe(true);
    expect(MemorySuggestionDecideRequestSchema.safeParse({ decision: "not_now" }).success).toBe(
      true,
    );
    expect(MemorySuggestionDecideRequestSchema.safeParse({ decision: "never" }).success).toBe(true);
    expect(MemorySuggestionDecideRequestSchema.safeParse({ decision: "later" }).success).toBe(
      false,
    );
  });
});

describe("export carries the flat memory row (ADR-059 user-authored core)", () => {
  it("accepts memories in the envelope and rejects an item-shaped (name-carrying) row", () => {
    const base = {
      format_version: 1,
      generated_at: NOW,
      scope: "user_authored_core",
      truncated: false,
      counts: {
        projects: { returned: 0, total: 0 },
        tasks: { returned: 0, total: 0 },
        notes: { returned: 0, total: 0 },
        inbox_items: { returned: 0, total: 0 },
        memories: { returned: 1, total: 1 },
        action_requests: { returned: 0, total: 0 },
      },
      projects: [],
      tasks: [],
      notes: [],
      inbox_items: [],
      memories: [row],
      action_requests: [],
    };
    expect(ExportResponseSchema.safeParse(base).success).toBe(true);
    expect(
      ExportResponseSchema.safeParse({
        ...base,
        memories: [{ ...row, project: { id: UUID, name: "Thesis" }, course: null }],
      }).success,
    ).toBe(false);
  });
});
