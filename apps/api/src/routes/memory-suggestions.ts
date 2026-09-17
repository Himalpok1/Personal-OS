import { memories, memorySuggestions } from "@personal-os/db";
import {
  MEMORY_SUGGESTION_NOT_NOW_DAYS,
  MemorySuggestionDecideRequestSchema,
  MemorySuggestionDecideResponseSchema,
  MemorySuggestionKindSchema,
  MemorySuggestionsResponseSchema,
  type MemoryItem,
  type MemorySuggestionDecideResponse,
  type MemorySuggestionDecision,
  type MemorySuggestionKind,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getMemoryItem,
  isMemoryEnabled,
  listPendingMemorySuggestions,
  type MemoryReader,
} from "../read-models/memories.js";
import { memoryLinkValidationIssue, projectExists } from "./memories.js";

// Memory suggestions (Checkpoint 10.7, ADR-077 §4).
//
// A suggestion is COMPUTED at request time (read-models/memories.ts) from rows
// the owner already sees, and is never stored while pending. Only the owner's
// ANSWER persists: one `memory_suggestions` row per key, carrying the decision
// and -- for `not_now` -- when it may be offered again, but never the
// statement text, so "never ask again" cannot become a second copy of what
// the owner declined to remember. `remember` additionally writes the memory
// with `source = 'suggestion'` and the statement the owner saw or edited: the
// server never composes stored text on the owner's behalf.
//
// The switch gates this surface entirely: an off switch answers `[]` on the
// list and `409 memory_disabled` on a decision. Deciding is one transaction,
// and a repeated identical decision is idempotent (200) while a conflicting
// one is refused (409) -- the decision row is the truth, and it is not
// rewritten by a later, different answer.

const DAY_MS = 24 * 60 * 60 * 1000;

const KeyParamsSchema = z.object({ key: z.string().min(1) });

interface ParsedSuggestionKey {
  kind: MemorySuggestionKind;
  entityId: string;
}

/**
 * `<kind>:<uuid>`. Anything else -- an unknown kind, a malformed id, a missing
 * separator -- is `400 validation_failed` with an issue on `key`, never a
 * 404: the key is caller input, not a stored identifier.
 */
function parseSuggestionKey(raw: string): ParsedSuggestionKey | null {
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  const kind = MemorySuggestionKindSchema.safeParse(raw.slice(0, separator));
  const entityId = z
    .string()
    .uuid()
    .safeParse(raw.slice(separator + 1));
  if (!kind.success || !entityId.success) return null;
  return { kind: kind.data, entityId: entityId.data };
}

const keyValidationIssue = {
  code: "custom" as const,
  path: ["key"] as const,
  message: "key must be <suggestion kind>:<uuid>",
};

/** The stored `status` vocabulary and the wire `decision` vocabulary, mapped both ways. */
const STATUS_FOR_DECISION: Record<MemorySuggestionDecision, "accepted" | "dismissed" | "never"> = {
  remember: "accepted",
  not_now: "dismissed",
  never: "never",
};

function decisionForStatus(status: string): MemorySuggestionDecision | null {
  for (const [decision, stored] of Object.entries(STATUS_FOR_DECISION)) {
    if (stored === status) return decision as MemorySuggestionDecision;
  }
  return null;
}

/** The memory an `accepted` row produced, if it still exists (delete means delete). */
async function acceptedMemory(db: MemoryReader, suggestionId: string): Promise<MemoryItem | null> {
  const [row] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(eq(memories.suggestionId, suggestionId))
    .limit(1);
  return row ? getMemoryItem(db, row.id) : null;
}

type DecideOutcome =
  | { status: 200 | 201; body: MemorySuggestionDecideResponse }
  | { status: 400; body: { error: "validation_failed"; issues: unknown[] } }
  | { status: 409; body: { error: "memory_disabled" | "memory_suggestion_already_decided" } };

export default function memorySuggestionsRoutes(app: FastifyInstance): void {
  app.get("/memory-suggestions", async () =>
    MemorySuggestionsResponseSchema.parse({ items: await listPendingMemorySuggestions(app.db) }),
  );

  app.post<{ Params: { key: string } }>(
    "/memory-suggestions/:key/decide",
    async (request, reply) => {
      const params = KeyParamsSchema.parse(request.params);
      const body = MemorySuggestionDecideRequestSchema.parse(request.body);
      const parsed = parseSuggestionKey(params.key);
      if (!parsed) {
        reply.code(400);
        return { error: "validation_failed", issues: [keyValidationIssue] };
      }
      const key = params.key;

      const outcome = await app.db.transaction(async (tx): Promise<DecideOutcome> => {
        if (!(await isMemoryEnabled(tx)))
          return { status: 409, body: { error: "memory_disabled" } };

        const [existing] = await tx
          .select({ id: memorySuggestions.id, status: memorySuggestions.status })
          .from(memorySuggestions)
          .where(eq(memorySuggestions.suggestionKey, key))
          .limit(1);

        if (existing) {
          if (decisionForStatus(existing.status) !== body.decision) {
            return { status: 409, body: { error: "memory_suggestion_already_decided" } };
          }
          const memory =
            body.decision === "remember" ? await acceptedMemory(tx, existing.id) : null;
          return {
            status: 200,
            body: MemorySuggestionDecideResponseSchema.parse({
              key,
              decision: body.decision,
              memory,
            }),
          };
        }

        // The suggestion was derived from a live project row, so this is a
        // race guard against the project vanishing between the offer and the
        // answer -- the memory's project link must resolve when written.
        const projectId = parsed.kind === "project_goal" ? parsed.entityId : null;
        if (body.decision === "remember" && projectId && !(await projectExists(tx, projectId))) {
          return {
            status: 400,
            body: { error: "validation_failed", issues: [memoryLinkValidationIssue("project_id")] },
          };
        }

        const now = new Date();
        const [decisionRow] = await tx
          .insert(memorySuggestions)
          .values({
            suggestionKey: key,
            suggestionKind: parsed.kind,
            projectId,
            status: STATUS_FOR_DECISION[body.decision],
            askAgainAfter:
              body.decision === "not_now"
                ? new Date(now.getTime() + MEMORY_SUGGESTION_NOT_NOW_DAYS * DAY_MS)
                : null,
            decidedAt: now,
          })
          .returning({ id: memorySuggestions.id });
        if (!decisionRow) throw new Error("insert into memory_suggestions returned no row");

        if (body.decision !== "remember") {
          return {
            status: 200,
            body: MemorySuggestionDecideResponseSchema.parse({
              key,
              decision: body.decision,
              memory: null,
            }),
          };
        }

        // `statement` is guaranteed present for `remember` by the request
        // schema's refine; the narrowing is repeated here for the type only.
        if (body.statement === undefined) throw new Error("remember without a statement");
        const [memoryRow] = await tx
          .insert(memories)
          .values({
            kind: "goal",
            statement: body.statement,
            note: body.note ?? null,
            source: "suggestion",
            suggestionId: decisionRow.id,
            projectId,
          })
          .returning({ id: memories.id });
        if (!memoryRow) throw new Error("insert into memories returned no row");
        const memory = await getMemoryItem(tx, memoryRow.id);
        if (!memory) throw new Error("memory row vanished inside its own transaction");
        return {
          status: 201,
          body: MemorySuggestionDecideResponseSchema.parse({ key, decision: "remember", memory }),
        };
      });

      // Returned after `reply.code(...)`; see routes/memories.ts.
      reply.code(outcome.status);
      return outcome.body;
    },
  );
}
