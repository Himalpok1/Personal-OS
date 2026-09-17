// GET /export -- retrieving the content the owner authored (Checkpoint 8.3).
//
// ===========================================================================
// SCOPE: USER-AUTHORED CORE ONLY, AND EVERY OMISSION IS A DECISION
// ===========================================================================
//
// Five entities: `projects`, `tasks`, `notes`, `inbox_items` and (since
// Checkpoint 10.7) `memories`. These are the
// tables whose every row exists because the owner typed, dictated or captured
// it. Nothing else is included, and the exclusions are not an unfinished list:
//
//   - `events`. Calendar events are overwhelmingly authored by OTHER PEOPLE and
//     arrive through Google/CalDAV sync. Checkpoint 8.2 put 98 real events into
//     this database, whose stored descriptions include conference links and
//     meeting passcodes -- third-party material about third parties. Exporting
//     it is a separate decision with a separate argument.
//   - `mail_messages`. Third-party metadata, two fields of it attacker-chosen,
//     and ADR-054 governs where it may go.
//   - Health. Sensitive integrated measurement data, and ADR-046 makes it
//     passive by design.
//   - Monitoring, sync runs, dispatch logs, OAuth state, AI configuration,
//     briefs and digests. Operational records, not content.
//   - Every credential column in the system.
//
// This surface is REACHABLE, not merely defined: adding an entity here means
// adding a projection and a schema below, so growth is deliberate. There is no
// "and the rest of the tables" branch to accidentally widen.
//
// ===========================================================================
// WHAT THIS IS NOT
// ===========================================================================
//
// It is NOT a backup, and ADR-024 is untouched by it. It reads four tables over
// the existing Tailscale perimeter and returns JSON to the caller. It creates
// no file on the server, uploads nothing, mails nothing, writes nothing, and
// has no schedule. A database backup system remains unapproved and unbuilt.

import { z } from "zod";
import { InboxEntityTypeSchema, InboxItemStatusSchema } from "./inbox.js";
import { NoteSchema } from "./notes.js";
import { ProjectSchema } from "./projects.js";
import { CaptureSourceSchema } from "./capture.js";
import { TaskSchema } from "./tasks.js";
import { MemorySchema } from "./memories.js";

/**
 * Bumped only on a BREAKING change to the envelope, so a file written today
 * stays readable. Additive fields do not bump it.
 */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Per-entity safety ceiling.
 *
 * An export exists to be complete, so this is not a page size and there is no
 * `limit` parameter -- it is the bound that stops one runaway table from
 * producing an unbounded response. It is reported honestly (see
 * `ExportEntityCountSchema`), because an export that silently drops rows is
 * worse than one that refuses to: the reader would never know.
 *
 * Production currently holds single-digit row counts in all four tables, so
 * this is three to four orders of magnitude of headroom.
 */
export const EXPORT_ENTITY_MAX_ROWS = 10_000;

// ===========================================================================
// PER-ENTITY SHAPES
// ===========================================================================
//
// Three of the four REUSE the frozen entity schema the list endpoints already
// return. That is the point rather than a shortcut: those shapes are already
// audited, already covered by tests, and already prove that no ciphertext, IV,
// auth tag, token hash or provider credential can reach the wire, because a
// non-passthrough Zod object drops anything not named in it. Inventing a
// parallel export shape would create a second allowlist to keep in step with
// the first, and the two would drift.

export const TaskExportSchema = TaskSchema;
export const NoteExportSchema = NoteSchema;
export const ProjectExportSchema = ProjectSchema;
/**
 * Checkpoint 10.7 (ADR-077): memories are the owner's most deliberately
 * authored content -- every row was typed or explicitly accepted -- and the
 * only user-authored entity with no soft delete, so the export is the one undo
 * a deletion has (ADR-024). The FLAT row is exported (ids, never the resolved
 * project/course names -- those are display denormalization). The
 * `memory_suggestions` decision table and the `memory_settings` switch are
 * plumbing, like `client_uuid`, and stay out.
 */
export const MemoryExportSchema = MemorySchema;

/**
 * Inbox items are the one NARROWED shape, and the narrowing is deliberate.
 *
 * `InboxItemSchema` (what GET /inbox returns) additionally carries
 * `client_uuid`, `confidence` and `parse_result`. None is authored content:
 *
 *   - `client_uuid` is the offline outbox's idempotency key -- plumbing.
 *   - `confidence` is documented in the schema itself as a temporarily
 *     overloaded column that means different things before and after parsing,
 *     which makes it actively misleading in an archival file.
 *   - `parse_result` is `z.unknown()` -- unbounded, machine-written LLM output.
 *     Excluding it is what keeps EVERY value in this export a bounded scalar or
 *     null, which is a property worth having in a file whose whole purpose is
 *     to be read years later by something that is not this codebase.
 *
 * What survives is exactly the capture and what became of it: the raw text the
 * owner captured, how it arrived, when, and which entity it turned into.
 */
export const InboxItemExportSchema = z
  .object({
    id: z.string().uuid(),
    /** Nullable: a PTT capture exists before its transcript does. */
    raw_text: z.string().nullable(),
    source: CaptureSourceSchema,
    captured_at: z.string().datetime({ offset: true }),
    timezone: z.string(),
    status: InboxItemStatusSchema,
    entity_type: InboxEntityTypeSchema.nullable(),
    entity_id: z.string().uuid().nullable(),
    created_at: z.string().datetime({ offset: true }),
    /** Checkpoint 9.3: dismissed captures are exported too (ADR-059). */
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type InboxItemExport = z.infer<typeof InboxItemExportSchema>;

/** Honest counts: `total` is what matched, `returned` is what fitted. */
export const ExportEntityCountSchema = z
  .object({
    returned: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict()
  .refine((counts) => counts.total >= counts.returned, {
    message: "total must not be smaller than the returned count",
  });
export type ExportEntityCount = z.infer<typeof ExportEntityCountSchema>;

export const ExportCountsSchema = z
  .object({
    projects: ExportEntityCountSchema,
    tasks: ExportEntityCountSchema,
    notes: ExportEntityCountSchema,
    inbox_items: ExportEntityCountSchema,
    memories: ExportEntityCountSchema,
  })
  .strict();
export type ExportCounts = z.infer<typeof ExportCountsSchema>;

/**
 * ARCHIVED ROWS ARE INCLUDED, ALWAYS, and there is no flag to exclude them.
 *
 * `archived_at` is a soft delete: the row is still the owner's content and the
 * system has no restore path for most of it. An export that dropped archived
 * rows would quietly be the one copy that lost them. Every row carries its own
 * `archived_at`, so a consumer that wants only live rows can filter, while one
 * that wants everything cannot be silently short-changed.
 *
 * Ordering is `created_at` ascending, then `id` ascending. Oldest-first because
 * an archive reads chronologically, and `id` because two rows can share a
 * timestamp -- the same tie-break the search contract makes for the same
 * observed reason.
 */
export const ExportResponseSchema = z
  .object({
    format_version: z.literal(EXPORT_FORMAT_VERSION),
    /** When the export was assembled. */
    generated_at: z.string().datetime({ offset: true }),
    /** Names the contract above, so a reader knows what is NOT in the file. */
    scope: z.literal("user_authored_core"),
    /** True when any entity had more rows than EXPORT_ENTITY_MAX_ROWS. */
    truncated: z.boolean(),
    counts: ExportCountsSchema,
    projects: z.array(ProjectExportSchema),
    tasks: z.array(TaskExportSchema),
    notes: z.array(NoteExportSchema),
    inbox_items: z.array(InboxItemExportSchema),
    memories: z.array(MemoryExportSchema),
  })
  .strict();
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
