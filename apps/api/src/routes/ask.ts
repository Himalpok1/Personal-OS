// POST /ask -- Cloud Ask (Checkpoint 8.6B, ADR-056/8.6B design).
//
// Synchronous, like POST /briefs: retrieval + generation happen inline and the
// route returns the answer, never a job handle. Order matters and is fixed:
//
//   authorizeCloudAsk -> extractAskTerms -> selectAskContext -> buildAskContext
//   -> generateAskAnswer -> sanitizeAskAnswer (inside generateAskAnswer)
//
// The switch is checked BEFORE any note or task row is read (a `null` grant
// returns 409 having touched neither table), and a question that yields no
// terms or no matching rows returns 422 having made NO model call at all --
// both asserted by tests with a counting `db` shim.
//
// Error mapping is explicit here, matching apps/api/src/routes/briefs.ts:
// server.ts's setErrorHandler only passes a thrown error's own statusCode
// through when it is 4xx, and NoProviderConfiguredError carries no statusCode
// of its own at all -- so every error this route can produce is caught and
// replied to by name, never left to fall through to the generic handler's
// `request.log.error({ err })`.
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { extractAskTerms } from "@personal-os/core/ask/extract-terms";
import { log } from "@personal-os/core/logging/logger";
import { AskRequestSchema, AskResponseSchema, type AskResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { authorizeCloudAsk, consumeGrant } from "../ask/authorize.js";
import {
  AskGenerationFailedError,
  AskProviderDisabledError,
  AskTimeoutError,
} from "../ask/contracts.js";
import { generateAskAnswer } from "../ask/generate.js";
import { buildAskContext } from "../ask/redact.js";
import { selectAskContext } from "../ask/select-context.js";
import { env } from "../env.js";

/**
 * Process-level in-flight flag (design §6.5). Ask has no natural identity to
 * dedupe on the way the Brief dedupes on `(brief_date, timezone)`, so this is
 * what closes double-tap and concurrent submission, and what makes the
 * DELETE-vs-in-flight-request race in `ai-config.ts` bounded: at most one
 * generation call is ever in flight in this process at a time.
 */
let askInFlight = false;

export default function askRoutes(app: FastifyInstance): void {
  app.post("/ask", async (request, reply) => {
    if (askInFlight) {
      return reply.code(429).send({ error: "ask_in_flight" });
    }
    askInFlight = true;

    try {
      // The switch is checked FIRST, before the body is even validated against
      // a term list -- a disabled Ask returns 409 having read no notes/tasks
      // row and extracted no terms.
      const grant = await authorizeCloudAsk(request, app.db);
      if (grant === null) {
        return reply.code(409).send({ error: "cloud_ask_disabled" });
      }

      const { question } = AskRequestSchema.parse(request.body);

      const terms = extractAskTerms(question);
      if (terms.length === 0) {
        return reply.code(422).send({ error: "no_relevant_context" });
      }

      const candidates = await selectAskContext(app.db, grant, terms);
      if (candidates.length === 0) {
        return reply.code(422).send({ error: "no_relevant_context" });
      }

      const context = buildAskContext(candidates);
      if (context.records.length === 0) {
        // Defensive: only reachable if the drop ladder in buildAskContext ever
        // emptied a non-empty candidate set, which the configured bounds
        // should never allow (see redact.ts's module comment).
        return reply.code(422).send({ error: "no_relevant_context" });
      }

      let generated: Awaited<ReturnType<typeof generateAskAnswer>>;
      try {
        generated = await generateAskAnswer(
          app.db,
          grant,
          question,
          context.serializedRecords,
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
      } catch (error) {
        // COUNTS ONLY -- no question, no context, no answer, no source text.
        log.warn("ask.failed", {
          outcome:
            error instanceof NoProviderConfiguredError || error instanceof AskProviderDisabledError
              ? "no_provider"
              : error instanceof AskTimeoutError
                ? "timeout"
                : "failed",
          sourceCount: context.records.length,
          contextChars: context.contextChars,
        });
        if (error instanceof NoProviderConfiguredError) {
          return reply.code(409).send({ error: "cloud_ask_disabled" });
        }
        if (error instanceof AskProviderDisabledError) {
          return reply.code(409).send({ error: "no_provider_configured" });
        }
        if (error instanceof AskTimeoutError) {
          return reply.code(504).send({ error: "ask_timeout" });
        }
        if (error instanceof AskGenerationFailedError) {
          return reply.code(502).send({ error: "ask_failed" });
        }
        // Never let anything else escape raw -- same discipline as
        // BriefGenerationFailedError's catch-all in generateDailyBrief.
        return reply.code(502).send({ error: "ask_failed" });
      }

      // Single-use: this authorization has now produced its one transmission.
      consumeGrant(grant);

      const sources = context.records.map((record, index) => {
        // Zipped by index, not looked up: buildAskContext guarantees
        // survivingCandidates is the same order and length as records.
        const candidate = context.survivingCandidates[index];
        if (!candidate) throw new Error("ask: survivingCandidates/records length mismatch");
        return { ref: record.ref, type: record.type, id: candidate.id, title: record.title };
      });

      // COUNTS ONLY, exactly the design's §9 field list. No question, no
      // context, no answer, no source title, no uuid.
      log.info("ai.usage", {
        task: "ask",
        modelId: generated.modelRowId,
        latencyMs: generated.latencyMs,
        ...(generated.usageIn === undefined ? {} : { usageIn: generated.usageIn }),
        ...(generated.usageOut === undefined ? {} : { usageOut: generated.usageOut }),
        ...(generated.usageTotal === undefined ? {} : { usageTotal: generated.usageTotal }),
        ...(generated.finishReason === undefined ? {} : { finishReason: generated.finishReason }),
        sourceCount: sources.length,
        contextChars: context.contextChars,
        redactionCount: context.redactions,
        outcome: "answered",
      });

      const response: AskResponse = AskResponseSchema.parse({
        answer: generated.answer,
        sources,
        redactions: context.redactions,
        model_id: generated.modelRowId,
      });
      return reply.code(200).send(response);
    } finally {
      askInFlight = false;
    }
  });
}
