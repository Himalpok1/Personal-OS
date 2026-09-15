// POST /ask -- Cloud Ask (Checkpoint 8.6B, ADR-056/8.6B design; widened to
// "Ask about today" in Checkpoint 9.7, ADR-066).
//
// Synchronous, like POST /briefs: retrieval + generation happen inline and the
// route returns the answer, never a job handle. Order matters and is fixed:
//
//   authorizeCloudAsk -> [tz: consent vintage -> mintReadContext -> buildTodayContext]
//   -> [scope != "today": extractAskTerms -> selectAskContext -> buildAskContext]
//   -> generateAskAnswer -> sanitizeAskAnswer (inside generateAskAnswer)
//   -> [tz: validateCitations]
//
// The switch is checked BEFORE any note or task row is read (a `null` grant
// returns 409 having touched neither table), and -- on the 8.6B path -- a
// question that yields no terms or no matching rows returns 422 having made NO
// model call at all; both asserted by tests with a counting `db` shim.
//
// TWO PATHS, ONE ROUTE (design §6 invariant, route-tested):
//   * `tz` ABSENT -- the exact 8.6B behaviour and response shape: task/note
//     sources only, refs from 1, no `section`, no `citations_present`, 422 on
//     no terms / no candidates. The versionCode 18 client parses this with a
//     `.strict()` schema, so nothing new may appear here.
//   * `tz` PRESENT -- the 9.7 client. The Today context is built first and its
//     citations take refs 1..N; `<records>` (only for scope "both") continues
//     AFTER the highest Today ref ever assigned (`today.lastRef`, NOT
//     `citations.length` -- the ladder leaves gaps) under the narrower
//     5 000-char / 4-record ceilings; zero terms or zero candidates is NOT an
//     error (the day itself is the context); every `[n]` in the answer must
//     resolve or the answer is discarded.
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
import {
  AskRequestSchema,
  AskResponseSchema,
  askPresetForQuestion,
  type AskResponse,
  type AskSource,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { askRouteConsentedAt, authorizeCloudAsk, consumeGrant } from "../ask/authorize.js";
import { validateCitations } from "../ask/citations.js";
import {
  ASK_MAX_RECORDS_WITH_TODAY,
  ASK_RECORDS_MAX_CHARS_WITH_TODAY,
  ASK_TODAY_CONSENT_FROM,
  AskConsentOutdatedError,
  AskGenerationFailedError,
  AskProviderDisabledError,
  AskTimeoutError,
  AskUncitedAnswerError,
} from "../ask/contracts.js";
import { generateAskAnswer } from "../ask/generate.js";
import { buildAskContext, type AskContext } from "../ask/redact.js";
import { selectAskContext, type AskCandidateRecord } from "../ask/select-context.js";
import { env } from "../env.js";
import { mintReadContext } from "../intelligence/read-context.js";
import { buildTodayContext, type TodayContextBuild } from "../intelligence/today-context.js";

/**
 * Process-level in-flight flag (design §6.5). Ask has no natural identity to
 * dedupe on the way the Brief dedupes on `(brief_date, timezone)`, so this is
 * what closes double-tap and concurrent submission, and what makes the
 * DELETE-vs-in-flight-request race in `ai-config.ts` bounded: at most one
 * generation call is ever in flight in this process at a time.
 */
let askInFlight = false;

const EMPTY_CONTEXT: AskContext = {
  records: [],
  survivingCandidates: [],
  serializedRecords: "[]",
  redactions: 0,
  contextChars: 2,
};

/** Log token for the `scope` field: never the raw client value, always one of three. */
function scopeToken(tzPresent: boolean, scope: "today" | "both" | undefined): string {
  if (!tzPresent) return "none";
  return scope === "today" ? "today" : "both";
}

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

      const { question, tz, scope } = AskRequestSchema.parse(request.body);
      const tzPresent = tz !== undefined;
      const scopeForLog = scopeToken(tzPresent, scope);

      // -----------------------------------------------------------------
      // Checkpoint 9.7: the Today context (only when the client sent `tz`).
      // -----------------------------------------------------------------
      let today: TodayContextBuild | null = null;
      if (tz !== undefined) {
        // Consent vintage (design §13 item 10.1): a route row created under
        // the 8.6B disclosure must not be silently widened to the Today
        // context. Refused BEFORE any read model runs.
        const consentedAt = await askRouteConsentedAt(app.db);
        if (consentedAt === null) {
          // The row vanished between authorizeCloudAsk and here -- the same
          // race generate.ts maps to cloud_ask_disabled.
          return reply.code(409).send({ error: "cloud_ask_disabled" });
        }
        if (consentedAt.getTime() < Date.parse(ASK_TODAY_CONSENT_FROM)) {
          log.warn("ask.failed", { outcome: "consent_outdated", scope: scopeForLog });
          throw new AskConsentOutdatedError();
        }

        const ctx = mintReadContext(request, app.db, grant, tz);
        const preset = askPresetForQuestion(question);
        today = await buildTodayContext(ctx, preset === null ? {} : { preset });
      }

      // -----------------------------------------------------------------
      // The lexical <records> selection. Skipped ENTIRELY for scope "today"
      // (no notes/tasks read -- a preset chip about the schedule must never
      // ship a journal entry that happens to contain "focus").
      // -----------------------------------------------------------------
      let context: AskContext = EMPTY_CONTEXT;
      if (!(tzPresent && scope === "today")) {
        const terms = extractAskTerms(question);
        let candidates: AskCandidateRecord[] = [];
        if (terms.length === 0) {
          if (!tzPresent) return reply.code(422).send({ error: "no_relevant_context" });
        } else {
          candidates = await selectAskContext(app.db, grant, terms);
          if (candidates.length === 0 && !tzPresent) {
            return reply.code(422).send({ error: "no_relevant_context" });
          }
        }

        if (candidates.length > 0) {
          context =
            today === null
              ? buildAskContext(candidates)
              : buildAskContext(candidates, {
                  // The highest Today ref EVER assigned, not the surviving
                  // citation count: the ladder leaves gaps, and a record at
                  // `citations.length + 1` would collide with a kept Today ref.
                  refOffset: today.lastRef,
                  maxChars: ASK_RECORDS_MAX_CHARS_WITH_TODAY,
                  maxRecords: ASK_MAX_RECORDS_WITH_TODAY,
                });
        }

        if (context.records.length === 0 && !tzPresent) {
          // Defensive: only reachable if the drop ladder in buildAskContext
          // ever emptied a non-empty candidate set, which the configured
          // bounds should never allow (see redact.ts's module comment).
          return reply.code(422).send({ error: "no_relevant_context" });
        }
      }

      const todayLogFields =
        today === null ? {} : { todayChars: today.chars, todayItemCount: today.citations.length };

      // Ref-space invariant, checked BEFORE the transmission: every Today
      // citation and every record must own a distinct ref. A collision would
      // let a `[n]` resolve to two items, so the answer would cite the wrong
      // one silently -- refused here as ask_failed, never sent.
      if (today !== null) {
        const refSpace = new Set<number>([
          ...today.citations.map((c) => c.ref),
          ...context.records.map((r) => r.ref),
        ]);
        if (refSpace.size !== today.citations.length + context.records.length) {
          log.warn("ask.failed", {
            outcome: "ref_collision",
            sourceCount: today.citations.length + context.records.length,
            contextChars: context.contextChars,
            scope: scopeForLog,
            ...todayLogFields,
          });
          return reply.code(502).send({ error: "ask_failed" });
        }
      }

      let generated: Awaited<ReturnType<typeof generateAskAnswer>>;
      try {
        generated = await generateAskAnswer(
          app.db,
          grant,
          question,
          context.serializedRecords,
          env.CREDENTIALS_ENCRYPTION_KEY,
          today === null
            ? {}
            : { serializedToday: today.serialized, untrustedInputs: today.untrustedInputs },
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
          scope: scopeForLog,
          ...todayLogFields,
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

      const recordSources: AskSource[] = context.records.map((record, index) => {
        // Zipped by index, not looked up: buildAskContext guarantees
        // survivingCandidates is the same order and length as records.
        const candidate = context.survivingCandidates[index];
        if (!candidate) throw new Error("ask: survivingCandidates/records length mismatch");
        // The 8.6B shape carries exactly these four keys; `section` is added
        // only on the 9.7 path so the tz-less response stays byte-shape-identical.
        return today === null
          ? { ref: record.ref, type: record.type, id: candidate.id, title: record.title }
          : {
              ref: record.ref,
              type: record.type,
              id: candidate.id,
              title: record.title,
              section: "record",
            };
      });

      let sources: AskSource[] = recordSources;
      let citationsPresent: boolean | undefined;
      if (today !== null) {
        // Every [n] the model wrote must resolve to a ref the prompt carried.
        const validRefs = new Set<number>([
          ...today.citations.map((c) => c.ref),
          ...context.records.map((r) => r.ref),
        ]);
        const { unresolved, cited } = validateCitations(generated.answer, validRefs);
        if (unresolved.length > 0) {
          log.warn("ask.failed", {
            outcome: "uncited",
            unresolvedCount: unresolved.length,
            sourceCount: validRefs.size,
            contextChars: context.contextChars,
            scope: scopeForLog,
            ...todayLogFields,
          });
          throw new AskUncitedAnswerError();
        }
        citationsPresent = cited.length > 0;

        const todaySources: AskSource[] = today.citations.map((c) => ({
          ref: c.ref,
          type: c.type,
          id: c.id,
          title: c.title,
          section: c.section,
          ...(c.detail === undefined ? {} : { detail: c.detail }),
          ...(c.occurs_at === undefined ? {} : { occurs_at: c.occurs_at }),
        }));
        sources = [...todaySources, ...recordSources].sort((a, b) => a.ref - b.ref);
      }

      // COUNTS ONLY, exactly the design's §9 field list (+ the 9.7 fields:
      // todayChars, todayItemCount, scope -- all counts or tokens). No
      // question, no context, no answer, no source title, no uuid.
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
        scope: scopeForLog,
        ...todayLogFields,
        outcome: "answered",
      });

      const response: AskResponse = AskResponseSchema.parse({
        answer: generated.answer,
        sources,
        redactions: context.redactions,
        model_id: generated.modelRowId,
        ...(citationsPresent === undefined ? {} : { citations_present: citationsPresent }),
      });
      return reply.code(200).send(response);
    } catch (error) {
      // The two 9.7 taxonomy classes are thrown above and replied to BY NAME
      // here (the AskTimeoutError pattern), so server.ts's generic handler --
      // which would `request.log.error({ err })` -- never sees them. Their
      // log lines were already written at the throw site with their counts.
      if (error instanceof AskConsentOutdatedError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      if (error instanceof AskUncitedAnswerError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    } finally {
      askInFlight = false;
    }
  });
}
