// Personal Memory & Preference Layer (Checkpoint 10.7, ADR-077).
//
// ===========================================================================
// WHAT A MEMORY IS, AND IS NOT
// ===========================================================================
//
// A memory is one bounded sentence the owner asked Personal OS to keep -- a
// preference, a goal, or a fact -- optionally linked to ONE project and/or
// ONE Canvas course. Every memory carries its provenance (`source`, and
// `suggestion_id` when it was accepted from a suggestion) and its dates. It
// is created by the owner typing it or accepting a suggestion shown to them;
// nothing else writes one.
//
// It is NOT a knowledge graph, a behaviour log, or model memory. The read
// shape is deliberately `.strict()` so a future field is a reviewed decision,
// and the create/update shapes are bounded the ADR-065 way: user-typed text
// over the bound is REJECTED with a `400 validation_failed` naming the field.
//
// Memory NEVER reaches a model in 10.7: it is consumed only by the client-side,
// deterministic Focus Now / briefing composition in `packages/core`, and
// Guard 6 (apps/api/src/ask/ai-egress-guard.test.ts) makes that structural.

import { z } from "zod";
import { PaginationQuerySchema, paginatedResponseSchema } from "./pagination.js";
import {
  MEMORY_NOTE_MAX_CHARS,
  MEMORY_STATEMENT_MAX_CHARS,
  tooLongMessage,
} from "./text-bounds.js";

// ---- Closed vocabularies (CHECK-enforced in packages/db, ADR-050) --------

export const MEMORY_KINDS = ["preference", "goal", "fact"] as const;
export const MemoryKindSchema = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

/** `user` -- the owner typed it. `suggestion` -- the owner accepted a shown suggestion. */
export const MEMORY_SOURCES = ["user", "suggestion"] as const;
export const MemorySourceSchema = z.enum(MEMORY_SOURCES);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

/**
 * Every suggestion source is a reviewed decision about what may prompt the
 * owner (ADR-077 §4). 10.7 ships exactly one: a project the owner gave a goal
 * that has no goal memory linked to it yet.
 */
export const MEMORY_SUGGESTION_KINDS = ["project_goal"] as const;
export const MemorySuggestionKindSchema = z.enum(MEMORY_SUGGESTION_KINDS);
export type MemorySuggestionKind = z.infer<typeof MemorySuggestionKindSchema>;

export const MEMORY_SUGGESTION_DECISIONS = ["remember", "not_now", "never"] as const;
export const MemorySuggestionDecisionSchema = z.enum(MEMORY_SUGGESTION_DECISIONS);
export type MemorySuggestionDecision = z.infer<typeof MemorySuggestionDecisionSchema>;

/** How long "Not now" silences a suggestion key before it may be offered again. */
export const MEMORY_SUGGESTION_NOT_NOW_DAYS = 14;

// ---- The stored row (flat; reused verbatim by GET /export) ---------------

const statementField = z
  .string()
  .trim()
  .min(1, "statement must not be empty")
  .max(MEMORY_STATEMENT_MAX_CHARS, tooLongMessage("statement", MEMORY_STATEMENT_MAX_CHARS));

const noteField = z
  .string()
  .max(MEMORY_NOTE_MAX_CHARS, tooLongMessage("note", MEMORY_NOTE_MAX_CHARS));

export const MemorySchema = z
  .object({
    id: z.string().uuid(),
    kind: MemoryKindSchema,
    statement: z.string(),
    note: z.string().nullable(),
    source: MemorySourceSchema,
    suggestion_id: z.string().uuid().nullable(),
    project_id: z.string().uuid().nullable(),
    canvas_course_id: z.string().uuid().nullable(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type Memory = z.infer<typeof MemorySchema>;

// ---- The list/detail item: the row plus the NAMES its links resolve to ---

export const MemoryLinkedProjectSchema = z
  .object({ id: z.string().uuid(), name: z.string() })
  .strict();
export const MemoryLinkedCourseSchema = z
  .object({ id: z.string().uuid(), name: z.string(), course_code: z.string().nullable() })
  .strict();

/**
 * `project` / `course` are `null` when the link is null OR when the linked row
 * no longer exists as a live target (an archived course still resolves -- the
 * memory keeps its context; only a deleted row, which `set null` clears, is
 * gone). Names are display denormalization only; nothing else about the
 * linked entity is copied.
 */
export const MemoryItemSchema = MemorySchema.extend({
  project: MemoryLinkedProjectSchema.nullable(),
  course: MemoryLinkedCourseSchema.nullable(),
}).strict();
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const MemoryListQuerySchema = PaginationQuerySchema.extend({
  kind: MemoryKindSchema.optional(),
  project_id: z.string().uuid().optional(),
  canvas_course_id: z.string().uuid().optional(),
});
export type MemoryListQuery = z.infer<typeof MemoryListQuerySchema>;

export const MemoryListResponseSchema = paginatedResponseSchema(MemoryItemSchema);
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

// ---- Writes ---------------------------------------------------------------

/** `source` is never client-supplied: POST /memories always writes `user`. */
export const MemoryCreateSchema = z
  .object({
    kind: MemoryKindSchema,
    statement: statementField,
    note: noteField.optional(),
    project_id: z.string().uuid().optional(),
    canvas_course_id: z.string().uuid().optional(),
  })
  .strict();
export type MemoryCreate = z.infer<typeof MemoryCreateSchema>;

/** `source` and `suggestion_id` are provenance and can never be edited. */
export const MemoryUpdateSchema = z
  .object({
    kind: MemoryKindSchema.optional(),
    statement: statementField.optional(),
    note: noteField.nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
    canvas_course_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;

/** POST /memories/delete-all: the literal `true` is the confirmation. */
export const MemoryDeleteAllRequestSchema = z.object({ confirm: z.literal(true) }).strict();
export type MemoryDeleteAllRequest = z.infer<typeof MemoryDeleteAllRequestSchema>;

export const MemoryDeleteAllResponseSchema = z
  .object({ deleted: z.number().int().min(0) })
  .strict();
export type MemoryDeleteAllResponse = z.infer<typeof MemoryDeleteAllResponseSchema>;

// ---- The global switch ----------------------------------------------------

export const MemorySettingsSchema = z
  .object({
    enabled: z.boolean(),
    memory_count: z.number().int().min(0),
  })
  .strict();
export type MemorySettings = z.infer<typeof MemorySettingsSchema>;

export const MemorySettingsUpdateSchema = z.object({ enabled: z.boolean() }).strict();
export type MemorySettingsUpdate = z.infer<typeof MemorySettingsUpdateSchema>;

// ---- Suggestions (computed at request time; only the ANSWER is stored) ----

/**
 * A pending suggestion is derived from rows the owner already sees and is
 * never persisted: `key` is `<kind>:<entity id>`, `statement` is the proposed
 * sentence re-derived from the source row, and `evidence` is the human line
 * that cites where it came from ("From the goal you set on Thesis"), so the
 * owner can check the claim on the row itself.
 */
export const MemorySuggestionSchema = z
  .object({
    key: z.string(),
    kind: MemorySuggestionKindSchema,
    /** The kind of memory accepting this would create. */
    memory_kind: MemoryKindSchema,
    statement: z.string(),
    evidence: z.string(),
    project: MemoryLinkedProjectSchema.nullable(),
  })
  .strict();
export type MemorySuggestion = z.infer<typeof MemorySuggestionSchema>;

export const MemorySuggestionsResponseSchema = z
  .object({ items: z.array(MemorySuggestionSchema) })
  .strict();
export type MemorySuggestionsResponse = z.infer<typeof MemorySuggestionsResponseSchema>;

/**
 * `remember` REQUIRES the statement the owner saw (or edited) -- the server
 * never composes stored text on the owner's behalf; it stores what they
 * confirmed. `not_now` and `never` carry nothing but the decision.
 */
export const MemorySuggestionDecideRequestSchema = z
  .object({
    decision: MemorySuggestionDecisionSchema,
    statement: statementField.optional(),
    note: noteField.optional(),
  })
  .strict()
  .refine((value) => value.decision !== "remember" || value.statement !== undefined, {
    message: "statement is required when the decision is remember",
    path: ["statement"],
  });
export type MemorySuggestionDecideRequest = z.infer<typeof MemorySuggestionDecideRequestSchema>;

export const MemorySuggestionDecideResponseSchema = z
  .object({
    key: z.string(),
    decision: MemorySuggestionDecisionSchema,
    /** Present only for `remember`. */
    memory: MemoryItemSchema.nullable(),
  })
  .strict();
export type MemorySuggestionDecideResponse = z.infer<typeof MemorySuggestionDecideResponseSchema>;

/** Deterministic key builder shared by the read model and the tests. */
export function memorySuggestionKey(kind: MemorySuggestionKind, entityId: string): string {
  return `${kind}:${entityId}`;
}
