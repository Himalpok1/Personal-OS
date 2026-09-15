// POST /focus/suggestion -- Suggested Focus (Checkpoint 9.8, design gate
// approved D1-D5, extends ADR-066).
//
// A narrower sibling of POST /ask: reuses the SAME "ask" task route as its
// consent switch (authorizeCloudAsk, askRouteConsentedAt, the
// ASK_TODAY_CONSENT_FROM vintage) and buildTodayContext (preset "focus",
// which protects the overdue/due_today sections from the drop ladder) as its
// ONLY data source. It is NOT open Q&A: the model picks exactly ONE task from
// today's overdue/due-today items and explains why in <=40 words, citing it.
//
// Synchronous, like POST /ask and POST /briefs: the server runs the one model
// call inline and returns the suggestion, never a job handle. Order:
//
//   in-flight guard -> authorizeCloudAsk -> parse body -> consent vintage
//   -> mintReadContext -> buildTodayContext(preset: "focus")
//   -> compute candidateRefs (overdue + due_today) -> if too few, refuse
//      BEFORE any model call -> generateFocusSuggestion -> consumeGrant
//   -> validateCitations against candidateRefs ONLY (never the full Today ref
//      space) -> exactly one resolved ref required -> respond
//
// Error mapping is explicit, matching apps/api/src/routes/ask.ts: no error
// this route can produce is left to the generic handler's
// `request.log.error({ err })`.
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { log } from "@personal-os/core/logging/logger";
import {
  FOCUS_MIN_CANDIDATES,
  FocusSuggestionRequestSchema,
  FocusSuggestionResponseSchema,
  type FocusSource,
  type FocusSuggestionResponse,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { askRouteConsentedAt, authorizeCloudAsk, consumeGrant } from "../ask/authorize.js";
import { validateCitations } from "../ask/citations.js";
import {
  ASK_TODAY_CONSENT_FROM,
  AskConsentOutdatedError,
  AskProviderDisabledError,
} from "../ask/contracts.js";
import { env } from "../env.js";
import {
  FocusGenerationFailedError,
  FocusTimeoutError,
  FocusUncitedAnswerError,
} from "../focus/contracts.js";
import { generateFocusSuggestion } from "../focus/generate.js";
import { mintReadContext } from "../intelligence/read-context.js";
import { buildTodayContext } from "../intelligence/today-context.js";

/**
 * Process-level in-flight flag, OWN to this route -- deliberately NOT shared
 * with `askInFlight` in routes/ask.ts. The two routes are independent; a
 * concurrent /ask and /focus/suggestion request may both be in flight, but
 * two concurrent /focus/suggestion requests may not (mirrors ask.ts's design
 * for double-tap and concurrent-submission protection).
 */
let focusInFlight = false;

export default function focusRoutes(app: FastifyInstance): void {
  app.post("/focus/suggestion", async (request, reply) => {
    if (focusInFlight) {
      return reply.code(429).send({ error: "focus_in_flight" });
    }
    focusInFlight = true;

    try {
      // The switch is checked FIRST -- a disabled Cloud Ask returns 409
      // having read no notes/tasks row at all, exactly like /ask.
      const grant = await authorizeCloudAsk(request, app.db);
      if (grant === null) {
        return reply.code(409).send({ error: "cloud_ask_disabled" });
      }

      const { tz } = FocusSuggestionRequestSchema.parse(request.body);

      // Consent vintage (identical to routes/ask.ts's tz-present branch): a
      // route row created under the 8.6B disclosure (task/note bodies only)
      // must not be silently widened to the Today context.
      const consentedAt = await askRouteConsentedAt(app.db);
      if (consentedAt === null) {
        // The row vanished between authorizeCloudAsk and here -- the same
        // race ask/generate.ts maps to cloud_ask_disabled.
        return reply.code(409).send({ error: "cloud_ask_disabled" });
      }
      if (consentedAt.getTime() < Date.parse(ASK_TODAY_CONSENT_FROM)) {
        log.warn("focus.failed", { outcome: "consent_outdated" });
        throw new AskConsentOutdatedError();
      }

      const ctx = mintReadContext(request, app.db, grant, tz);
      const today = await buildTodayContext(ctx, { preset: "focus" });

      // Candidates are exactly the tasks in the overdue/due_today sections of
      // the built TodayContext. The "focus" preset protects both from the
      // drop ladder's MAIN pass, but today-context.ts's own "LAST RESORT"
      // pass (a documented, pre-existing tradeoff: "the ceiling is a
      // CONTRACT, the preset is a PREFERENCE") can still trim a protected
      // section if quote-heavy titles push the serialized size past
      // TODAY_CONTEXT_MAX_CHARS even after every unprotected section is
      // empty. This measurement is still always honest: candidateCount is
      // computed from the SAME post-ladder items serialized into the prompt,
      // so "what was measured" and "what the model received" can never
      // disagree with each other -- but a user could rarely see a
      // `focus_not_enough_candidates` refusal despite Today's own (pre-cap)
      // summary counts showing 2+. `today.droppedSections` names this if it
      // happens; not distinguished in the response today (recorded, not
      // fixed -- see the 9.8 adversarial review).
      const candidateRefs = new Set<number>([
        ...today.context.overdue.items.map((item) => item.ref),
        ...today.context.due_today.items.map((item) => item.ref),
      ]);
      const candidateCount = candidateRefs.size;

      if (candidateCount < FOCUS_MIN_CANDIDATES) {
        // No model call happens on this path -- the grant is released since
        // no generation will use it.
        consumeGrant(grant);
        return reply
          .code(409)
          .send({ error: "focus_not_enough_candidates", candidate_count: candidateCount });
      }

      let generated: Awaited<ReturnType<typeof generateFocusSuggestion>>;
      try {
        generated = await generateFocusSuggestion(
          app.db,
          grant,
          today.serialized,
          today.untrustedInputs,
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
      } catch (error) {
        // COUNTS ONLY -- never the today-context, never the generated text.
        log.warn("focus.failed", {
          outcome:
            error instanceof NoProviderConfiguredError || error instanceof AskProviderDisabledError
              ? "no_provider"
              : error instanceof FocusTimeoutError
                ? "timeout"
                : "failed",
          candidateCount,
          contextChars: today.chars,
        });
        if (error instanceof NoProviderConfiguredError) {
          return reply.code(409).send({ error: "cloud_ask_disabled" });
        }
        if (error instanceof AskProviderDisabledError) {
          return reply.code(409).send({ error: "no_provider_configured" });
        }
        if (error instanceof FocusTimeoutError) {
          return reply.code(504).send({ error: "focus_timeout" });
        }
        if (error instanceof FocusGenerationFailedError) {
          return reply.code(502).send({ error: "focus_failed" });
        }
        // Never let anything else escape raw.
        return reply.code(502).send({ error: "focus_failed" });
      }

      // Single-use: this authorization has now produced its one transmission.
      consumeGrant(grant);

      // Validated against the NARROWER candidate ref space (overdue/due_today
      // only), never the full Today ref space -- a citation of an "upcoming"
      // or "reminder" ref is exactly as uncited as one the model invented.
      const { unresolved, cited } = validateCitations(generated.suggestion, candidateRefs);
      if (cited.length !== 1 || unresolved.length > 0) {
        log.warn("focus.failed", {
          outcome: "uncited",
          candidateCount,
          contextChars: today.chars,
        });
        throw new FocusUncitedAnswerError();
      }

      const citation = today.citations.find((c) => c.ref === cited[0]);
      if (citation === undefined) {
        // Structurally unreachable: cited[0] is a member of candidateRefs,
        // and every candidateRef comes from an item buildTodayContext already
        // cited. Guarded rather than assumed.
        log.warn("focus.failed", { outcome: "failed", candidateCount, contextChars: today.chars });
        return reply.code(502).send({ error: "focus_failed" });
      }

      // citation.section is genuinely always "overdue" or "due_today" here --
      // candidateRefs was built ONLY from those two sections' refs.
      const source: FocusSource = {
        ref: citation.ref,
        type: "task",
        id: citation.id,
        title: citation.title,
        section: citation.section as "overdue" | "due_today",
        ...(citation.detail === undefined ? {} : { detail: citation.detail }),
      };

      // COUNTS ONLY -- never the today-context, never the suggestion text,
      // never any title beyond what is already in the typed response below.
      log.info("intelligence.focus.completed", {
        task: "focus",
        modelId: generated.modelRowId,
        latencyMs: generated.latencyMs,
        ...(generated.usageIn === undefined ? {} : { usageIn: generated.usageIn }),
        ...(generated.usageOut === undefined ? {} : { usageOut: generated.usageOut }),
        ...(generated.usageTotal === undefined ? {} : { usageTotal: generated.usageTotal }),
        ...(generated.finishReason === undefined ? {} : { finishReason: generated.finishReason }),
        candidateCount,
        contextChars: today.chars,
        outcome: "answered",
      });

      const response: FocusSuggestionResponse = FocusSuggestionResponseSchema.parse({
        suggestion: generated.suggestion,
        source,
        candidate_count: candidateCount,
        model_id: generated.modelRowId,
      });
      return reply.code(200).send(response);
    } catch (error) {
      // The two taxonomy classes thrown above are replied to BY NAME here
      // (the ask.ts pattern), so server.ts's generic handler -- which would
      // `request.log.error({ err })` -- never sees them.
      if (error instanceof AskConsentOutdatedError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      if (error instanceof FocusUncitedAnswerError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    } finally {
      focusInFlight = false;
    }
  });
}
