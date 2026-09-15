// Suggested Focus -- the wire contract (Checkpoint 9.8 design gate, approved
// D1-D5, extends ADR-066).
//
// A narrower sibling of Cloud Ask: reuses the "ask" task route as its
// consent switch (no new ai_task_routes row, no new disclosure surface) and
// `TodayContext` (`apps/api/src/intelligence/today-context.ts`) as its ONLY
// data source. The model is asked to do exactly one thing -- pick ONE task
// from today's overdue/due-today items and explain why in a sentence, citing
// it with its existing TodayContext ref. Never open Q&A, never stored, never
// scheduled, never proactive: strictly a POST triggered by an explicit tap.
//
// "Meaningful candidates" (owner-approved product constraint): a candidate is
// a task present in the built TodayContext's `overdue` or `due_today`
// sections. Below FOCUS_MIN_CANDIDATES, no model call is made at all -- the
// server refuses with `409 focus_not_enough_candidates` before resolving a
// provider, and the client is expected to not even render the affordance in
// that case (computed from data it already has from `GET /today`).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

/** Below this many candidates, no model call is made -- reject before touching a provider. */
export const FOCUS_MIN_CANDIDATES = 2;

export const FocusSuggestionRequestSchema = z
  .object({
    // Same requirement as Ask's `tz`: the server never guesses a zone.
    // Unlike Ask's `tz`, this one is REQUIRED -- there is no "today-less"
    // mode for a feature whose only content is today's schedule.
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
  })
  .strict();
export type FocusSuggestionRequest = z.infer<typeof FocusSuggestionRequestSchema>;

/** The only two TodayContext sections a candidate may come from. */
export const FocusSourceSectionSchema = z.enum(["overdue", "due_today"]);
export type FocusSourceSection = z.infer<typeof FocusSourceSectionSchema>;

export const FocusSourceSchema = z
  .object({
    ref: z.number().int().min(1),
    /** Always "task" -- overdue/due-today items are always tasks in TodayContext. */
    type: z.literal("task"),
    id: z.string().uuid(),
    title: z.string(),
    section: FocusSourceSectionSchema,
    /** Server-formatted detail (e.g. "P1"), same convention as AskSource.detail. */
    detail: z.string().max(80).optional(),
  })
  .strict();
export type FocusSource = z.infer<typeof FocusSourceSchema>;

export const FocusSuggestionResponseSchema = z
  .object({
    suggestion: z.string(),
    source: FocusSourceSchema,
    /** How many candidates existed when the suggestion was generated (>= FOCUS_MIN_CANDIDATES). */
    candidate_count: z.number().int().min(0),
    /** The `ai_models.id` that actually served the call. */
    model_id: z.string().uuid().nullable(),
  })
  .strict();
export type FocusSuggestionResponse = z.infer<typeof FocusSuggestionResponseSchema>;
