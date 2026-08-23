// Manual/on-demand AI Daily Brief route (Checkpoint 5.5, ADR-041).
//
// POST /briefs is synchronous: it collects a bounded, id-free snapshot
// (collectBriefInput), calls the configured `daily_brief` model route
// (generateDailyBrief), and -- ONLY once that call has fully succeeded --
// upserts the persisted brief keyed by the (brief_date, timezone) unique
// index. GET /briefs/current is a pure read: it never generates and never
// writes, and deliberately does not import the generation service at all.
//
// CRITICAL INVARIANT: a failed generation must never write, never overwrite
// an existing cached brief's content, and never touch its generated_at or
// model_id. This is enforced by construction -- the insert/upsert below is
// physically unreachable from the catch branch; every mapped error returns
// before it.
//
// Error mapping is explicit here rather than left to server.ts's generic
// handler: setErrorHandler only passes a thrown error's own statusCode
// through when it is 4xx (see server.ts's setErrorHandler and
// brief/contracts.ts's note above BriefGenerationTimeoutError) -- so
// NoProviderConfiguredError (409), BriefGenerationTimeoutError (504), and
// BriefGenerationFailedError (502) are each caught and replied to
// explicitly here. None of these responses ever carries a raw provider
// error's message/body -- only the static, pre-defined error codes below.
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { captureEffectiveNow, localDayWindow } from "@personal-os/core";
import { aiDailyBriefs } from "@personal-os/db";
import {
  BriefCurrentQuerySchema,
  BriefRequestSchema,
  DailyBriefRecordSchema,
  type DailyBriefRecord,
} from "@personal-os/schema";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { collectBriefInput } from "../brief/collect-input.js";
import { BriefGenerationFailedError, BriefGenerationTimeoutError } from "../brief/contracts.js";
import { generateDailyBrief } from "../brief/generate.js";
import { env } from "../env.js";

type AiDailyBriefRow = typeof aiDailyBriefs.$inferSelect;

function toBriefRecord(row: AiDailyBriefRow): DailyBriefRecord {
  return DailyBriefRecordSchema.parse({
    id: row.id,
    // date column round-trips as a plain YYYY-MM-DD string, same as
    // reviews.ts's period_start handling.
    brief_date: row.briefDate,
    timezone: row.timezone,
    content: row.content,
    model_id: row.modelId,
    generated_at: row.generatedAt.toISOString(),
  });
}

export default function briefsRoutes(app: FastifyInstance): void {
  app.post("/briefs", async (request, reply) => {
    const { tz } = BriefRequestSchema.parse(request.body);

    // The server picks brief_date from tz -- never accepted from the client
    // (ADR-041). localDate here is Today's own tz-local calendar date, not
    // a slice of an ISO instant.
    // Collection is bounded and should not fail, but an unexpected throw here
    // (e.g. a cap constant changed without re-checking the payload ceiling)
    // would otherwise reach the generic handler as an opaque 500 AND get its
    // raw message logged. Map it to the same sanitized failure the model path
    // uses, so no code path in this route can leak an internal message.
    let collected;
    try {
      collected = await collectBriefInput(app.db, { tz });
    } catch {
      return reply.code(502).send({ error: "brief_generation_failed" });
    }
    const { input, localDate } = collected;

    let generated: Awaited<ReturnType<typeof generateDailyBrief>>;
    try {
      generated = await generateDailyBrief(app.db, input, env.CREDENTIALS_ENCRYPTION_KEY);
    } catch (error) {
      if (error instanceof NoProviderConfiguredError) {
        return reply.code(409).send({ error: "no_provider_configured" });
      }
      if (error instanceof BriefGenerationTimeoutError) {
        return reply.code(504).send({ error: "brief_generation_timeout" });
      }
      if (error instanceof BriefGenerationFailedError) {
        return reply.code(502).send({ error: "brief_generation_failed" });
      }
      throw error;
    }

    // Reached only after generation fully succeeded -- see the CRITICAL
    // INVARIANT note above. Upsert by (brief_date, timezone): absent -> a
    // fresh row; existing -> content/model_id/generated_at all advance
    // together, never partially.
    const [row] = await app.db
      .insert(aiDailyBriefs)
      .values({
        briefDate: localDate,
        timezone: tz,
        content: generated.content,
        modelId: generated.modelRowId,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aiDailyBriefs.briefDate, aiDailyBriefs.timezone],
        set: {
          content: generated.content,
          modelId: generated.modelRowId,
          generatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("upsert into ai_daily_briefs returned no row");
    return reply.code(200).send(toBriefRecord(row));
  });

  app.get<{ Querystring: Record<string, string> }>("/briefs/current", async (request, reply) => {
    const { tz } = BriefCurrentQuerySchema.parse(request.query);

    // Deliberately independent of collectBriefInput/generateDailyBrief --
    // a pure read must never reach the AI layer. Same DST-safe local-day
    // math Today itself uses, never a slice of a UTC instant.
    const localDate = localDayWindow(tz, captureEffectiveNow()).localDate;

    const [row] = await app.db
      .select()
      .from(aiDailyBriefs)
      .where(and(eq(aiDailyBriefs.briefDate, localDate), eq(aiDailyBriefs.timezone, tz)));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toBriefRecord(row);
  });
}
