// Mail digest read + on-demand generation (Checkpoint 7.6, ADR-053/054).
//
// ===========================================================================
// THIS ROUTE READS AND ENQUEUES. IT NEVER GENERATES.
// ===========================================================================
//
// The Daily Brief generates synchronously inside this process (ADR-041/043), so
// `POST /briefs` can return the finished brief and classify its own failure. The
// mail digest cannot work that way: its pipeline lives in `apps/worker`, and
// apps/api must never import from apps/worker -- the two are separate processes
// whose only interface is Postgres and pg-boss (docs/ARCHITECTURE.md). Adding an
// app-to-app dependency to avoid a queue hop would be a new edge this repository
// has never had, for a feature that already has a queue.
//
// So `POST /mail-digests` enqueues the SAME job the daily cron enqueues, and
// returns 202. The consequence has to be respected rather than glossed: a 202
// means the work was accepted, NEVER that a digest now exists.
//
// What makes that honest rather than evasive is that every precondition which
// CAN be decided synchronously is decided here, before the 202. A user whose
// mailbox is disconnected, or whose server has no `mail_digest` model route,
// gets an immediate 409 naming the thing they can fix -- not a 202 followed by
// silence they would have to interpret.
//
// ---------------------------------------------------------------------------
// NO RAW ERROR REACHES A RESPONSE OR A LOG LINE.
//
// Every reply below is a static, pre-defined code. That matters more here than
// on most routes: the digest lane touches attacker-authored mail metadata, and
// `setErrorHandler`'s fallback branch logs the raw error it was given. Nothing
// in this file lets a provider string get that far.
import { aiTaskRoutes, mailConnections, mailDigests } from "@personal-os/db";
import {
  MailDigestCurrentResponseSchema,
  MailDigestGenerateAcceptedSchema,
  MailDigestRecordSchema,
  type MailDigestCurrentResponse,
  type MailDigestRecord,
} from "@personal-os/schema";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isMailConfigured } from "../services/mail-connection.js";
import { MAIL_DIGEST_GENERATE_QUEUE } from "../queue-names.js";

/** The `ai_task_routes.task_name` the worker's digest pipeline resolves. */
const MAIL_DIGEST_TASK = "mail_digest";

type MailDigestRow = typeof mailDigests.$inferSelect;

function toDigestRecord(row: MailDigestRow): MailDigestRecord {
  return MailDigestRecordSchema.parse({
    id: row.id,
    // A `date` column round-trips as a plain YYYY-MM-DD string -- see
    // packages/db's date type parser, which exists precisely so this is not a
    // UTC slice of an instant.
    digest_date: row.digestDate,
    timezone: row.timezone,
    // Parsed, not spread. `MailDigestContentSchema` is `.passthrough()`, so a
    // future server-authored field survives, but the schema is still what
    // decides the shape rather than whatever happens to be in the column.
    content: row.content,
    model_id: row.modelId,
    generated_at: row.generatedAt.toISOString(),
  });
}

/** Whether at least one mailbox is connected and syncing. */
async function hasActiveMailbox(app: FastifyInstance): Promise<boolean> {
  const [row] = await app.db
    .select({ id: mailConnections.id })
    .from(mailConnections)
    .where(eq(mailConnections.status, "active"))
    .limit(1);
  return row !== undefined;
}

async function hasDigestModelRoute(app: FastifyInstance): Promise<boolean> {
  const [row] = await app.db
    .select({ id: aiTaskRoutes.id })
    .from(aiTaskRoutes)
    .where(eq(aiTaskRoutes.taskName, MAIL_DIGEST_TASK))
    .limit(1);
  return row !== undefined;
}

export default function mailDigestsRoutes(app: FastifyInstance): void {
  /**
   * The current digest, plus the two facts an honest empty state needs.
   *
   * THERE IS NO `tz` PARAMETER, DELIBERATELY. A digest's identity is
   * `(digest_date, timezone)` where the zone is the WORKER's configuration
   * (`resolveDigestTimezone`), because a cron has nobody to ask. A client that
   * passed its own zone against a server configured for UTC -- the default --
   * would find no row and see an empty digest forever while one sat in the
   * table, generated an hour earlier under a different key.
   *
   * So this returns the digest the server actually has, newest first, and the
   * row carries its own date and zone so a screen can say what it covers.
   */
  app.get("/mail-digests/current", async (): Promise<MailDigestCurrentResponse> => {
    const [row] = await app.db
      .select()
      .from(mailDigests)
      // generated_at, not digest_date: regeneration advances the former while
      // the latter stays put, so ordering by date would pin a stale row as
      // "current" after a same-day regeneration.
      .orderBy(desc(mailDigests.generatedAt), desc(mailDigests.id))
      .limit(1);

    return MailDigestCurrentResponseSchema.parse({
      configured: isMailConfigured(),
      has_active_mailbox: await hasActiveMailbox(app),
      digest: row ? toDigestRecord(row) : null,
    } satisfies MailDigestCurrentResponse);
  });

  /**
   * Ask for a digest now.
   *
   * The preconditions are checked most-fundamental first, so the error names the
   * thing furthest upstream that the user can actually act on. Telling someone
   * "no AI provider" when the real problem is that no mailbox is connected sends
   * them to configure the wrong thing.
   */
  app.post("/mail-digests", async (_request, reply) => {
    if (!isMailConfigured()) {
      return reply.code(409).send({ error: "mail_not_configured" });
    }
    if (!(await hasActiveMailbox(app))) {
      // Matches the worker's own `no_active_mailboxes` skip reason, so the
      // synchronous answer and the asynchronous one use the same vocabulary.
      return reply.code(409).send({ error: "no_active_mailboxes" });
    }
    if (!(await hasDigestModelRoute(app))) {
      return reply.code(409).send({ error: "no_provider_configured" });
    }
    // Replied EXPLICITLY rather than thrown: `setErrorHandler` only passes a
    // thrown error's own statusCode through when it is 4xx, so a thrown 503
    // would arrive as an opaque 500 and get its raw message logged.
    if (!app.bossReady) {
      return reply.code(503).send({ error: "queue_unavailable" });
    }

    // A FIXED singletonKey, matching the worker's cron producer. The digest is
    // global, so several requests arriving together are several requests for the
    // same digest -- `stately` plus this key collapses them onto one slot rather
    // than paying a model call per tap.
    await app.boss.send(MAIL_DIGEST_GENERATE_QUEUE, {}, { singletonKey: "mail-digest" });

    return reply.code(202).send(MailDigestGenerateAcceptedSchema.parse({ accepted: true }));
  });
}
