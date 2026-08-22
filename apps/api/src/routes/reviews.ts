// Durable reviews API surface (Checkpoint 5.3, ADR-040). Identity is the
// frozen (kind, period_start) pair -- period_start is a LOCAL calendar date,
// never a UTC timestamp. Lifecycle rules: create upserts idempotently;
// complete/skip are legal only from in_progress with terminal-state
// idempotency at this layer (strict gates live in @personal-os/core's
// canCompleteReview/canSkipReview); content edits are legal only while the
// review is in flight and must match the row's kind exactly.
import { canCompleteReview, canSkipReview } from "@personal-os/core";
import { reviews } from "@personal-os/db";
import {
  ReviewCreateSchema,
  ReviewKindSchema,
  ReviewListQuerySchema,
  ReviewSchema,
  ReviewUpdateSchema,
  TodayQuerySchema,
  paginatedResponseSchema,
  reviewContentSchemaFor,
  type Review,
  type ReviewKind,
} from "@personal-os/schema";
import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  buildDailyReviewContext,
  buildWeeklyReviewContext,
} from "../read-models/review-contexts.js";

// Postgres keeps microseconds but JS Dates only carry milliseconds -- two
// rapid writes would otherwise stamp identical updated_at values and break
// "strictly advances" for anything using it as a change marker (same taste
// as routes/projects.ts).
function nextTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

type ReviewRow = typeof reviews.$inferSelect;

// Stable stringify for no-op detection: object key order is normalized so a
// DB jsonb round-trip never reads as a mutation.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function toReviewResponse(row: ReviewRow): Review {
  return ReviewSchema.parse({
    id: row.id,
    // Enforced to this vocabulary by the reviews_kind CHECK constraint.
    kind: row.kind as ReviewKind,
    // date columns round-trip as plain YYYY-MM-DD strings.
    period_start: row.periodStart,
    timezone: row.timezone,
    status: row.status,
    content: row.content ?? null,
    summary: row.summary,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
  });
}

async function findReview(app: FastifyInstance, id: string): Promise<ReviewRow | null> {
  const [row] = await app.db.select().from(reviews).where(eq(reviews.id, id));
  return row ?? null;
}

export default function reviewsRoutes(app: FastifyInstance): void {
  // Upsert by (kind, period_start): absent -> INSERT in_progress (201);
  // existing row of ANY status -> returned UNCHANGED (200) -- no reopen, no
  // reset, no updated_at bump. The conflict path doubles as a race-safe
  // fallback for two concurrent creates under the unique index.
  app.post("/reviews", async (request, reply) => {
    const body = ReviewCreateSchema.parse(request.body);
    const [inserted] = await app.db
      .insert(reviews)
      .values({ kind: body.kind, periodStart: body.period_start, timezone: body.tz })
      .onConflictDoNothing({ target: [reviews.kind, reviews.periodStart] })
      .returning();
    if (inserted) return reply.code(201).send(toReviewResponse(inserted));

    const [existing] = await app.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.kind, body.kind), eq(reviews.periodStart, body.period_start)));
    if (!existing) throw new Error("review insert conflicted but no winner row was found");
    return toReviewResponse(existing);
  });

  app.get<{ Querystring: Record<string, string> }>("/reviews", async (request) => {
    const query = ReviewListQuerySchema.parse(request.query);
    const where = query.kind ? eq(reviews.kind, query.kind) : undefined;
    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(reviews)
        .where(where)
        .orderBy(desc(reviews.periodStart), desc(reviews.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      app.db.select({ total: count() }).from(reviews).where(where),
    ]);
    return paginatedResponseSchema(ReviewSchema).parse({
      items: rows.map(toReviewResponse),
      limit: query.limit,
      offset: query.offset,
      total: Number(totalRows[0]?.total ?? 0),
    });
  });

  // Static paths registered alongside the parametric /reviews/:id below;
  // find-my-way always prefers the static segment (pinned by tests).
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/reviews/latest",
    async (request, reply) => {
      const kind =
        request.query["kind"] !== undefined
          ? ReviewKindSchema.parse(request.query["kind"])
          : undefined;
      const [row] = await app.db
        .select()
        .from(reviews)
        .where(kind ? eq(reviews.kind, kind) : undefined)
        .orderBy(desc(reviews.periodStart), desc(reviews.createdAt))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return toReviewResponse(row);
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/reviews/context/daily",
    async (request) => {
      const { tz } = TodayQuerySchema.parse(request.query);
      return buildDailyReviewContext(app.db, tz);
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/reviews/context/weekly",
    async (request) => {
      const { tz } = TodayQuerySchema.parse(request.query);
      return buildWeeklyReviewContext(app.db, tz);
    },
  );

  app.get<{ Params: { id: string } }>("/reviews/:id", async (request, reply) => {
    const row = await findReview(app, request.params.id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return toReviewResponse(row);
  });

  // Content/summary edits while in flight. Content is written whole (no
  // merge) and is KIND-BOUND: whatever union member ReviewUpdateSchema
  // accepted must additionally satisfy reviewContentSchemaFor(row.kind), so
  // e.g. a weekly checklist can never be stored on a daily row. Strict
  // schema rejects lifecycle fields (status/completed_at/...) with 400.
  app.patch<{ Params: { id: string } }>("/reviews/:id", async (request, reply) => {
    const body = ReviewUpdateSchema.parse(request.body);
    const existing = await findReview(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "in_progress") {
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }

    let content: unknown;
    if (body.content !== undefined) {
      const parsedContent = reviewContentSchemaFor(existing.kind as ReviewKind).safeParse(
        body.content,
      );
      if (!parsedContent.success) {
        return reply
          .code(400)
          .send({ error: "validation_failed", issues: parsedContent.error.issues });
      }
      content = parsedContent.data;
    }

    // No-op detection: an identical payload is not a real mutation and must
    // not advance updated_at.
    const summaryUnchanged = body.summary === undefined || body.summary === existing.summary;
    const contentUnchanged =
      body.content === undefined || canonicalJson(content) === canonicalJson(existing.content);
    if (summaryUnchanged && contentUnchanged) {
      return toReviewResponse(existing);
    }

    // Status predicate in the UPDATE closes the TOCTOU window between the
    // in_progress gate above and this write (e.g., a racing complete).
    const [row] = await app.db
      .update(reviews)
      .set({
        ...(body.content !== undefined && { content }),
        ...(body.summary !== undefined && { summary: body.summary }),
        updatedAt: nextTimestamp(existing.updatedAt),
      })
      .where(and(eq(reviews.id, request.params.id), eq(reviews.status, "in_progress")))
      .returning();
    if (!row) {
      const current = await findReview(app, request.params.id);
      if (!current) return reply.code(404).send({ error: "not_found" });
      return reply.code(409).send({ error: "invalid_status_transition", status: current.status });
    }
    return toReviewResponse(row);
  });

  // ---- Lifecycle actions ----
  // Real transitions stamp completed_at/skipped state once and bump
  // updated_at; re-running a terminal action on ITS OWN state is an
  // idempotent no-op returning the current row untouched (byte-stable --
  // original completed_at preserved, no updated_at bump); crossing states
  // (complete a skipped review, skip a completed one) is a 409.

  app.post<{ Params: { id: string } }>("/reviews/:id/complete", async (request, reply) => {
    const existing = await findReview(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!canCompleteReview(existing.status)) {
      if (existing.status === "completed") return toReviewResponse(existing);
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    // Status predicate closes the gate->write TOCTOU window (e.g., double-tap
    // completes): exactly one writer transitions; losers re-read and fall into
    // the same idempotent/409 logic against the winner's state.
    const [row] = await app.db
      .update(reviews)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: nextTimestamp(existing.updatedAt),
      })
      .where(and(eq(reviews.id, request.params.id), eq(reviews.status, "in_progress")))
      .returning();
    if (!row) {
      const current = await findReview(app, request.params.id);
      if (!current) return reply.code(404).send({ error: "not_found" });
      if (current.status === "completed") return toReviewResponse(current);
      return reply.code(409).send({ error: "invalid_status_transition", status: current.status });
    }
    return toReviewResponse(row);
  });

  app.post<{ Params: { id: string } }>("/reviews/:id/skip", async (request, reply) => {
    const existing = await findReview(app, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!canSkipReview(existing.status)) {
      if (existing.status === "skipped") return toReviewResponse(existing);
      return reply.code(409).send({ error: "invalid_status_transition", status: existing.status });
    }
    const [row] = await app.db
      .update(reviews)
      .set({
        status: "skipped",
        completedAt: null,
        updatedAt: nextTimestamp(existing.updatedAt),
      })
      .where(and(eq(reviews.id, request.params.id), eq(reviews.status, "in_progress")))
      .returning();
    if (!row) {
      const current = await findReview(app, request.params.id);
      if (!current) return reply.code(404).send({ error: "not_found" });
      if (current.status === "skipped") return toReviewResponse(current);
      return reply.code(409).send({ error: "invalid_status_transition", status: current.status });
    }
    return toReviewResponse(row);
  });
}
