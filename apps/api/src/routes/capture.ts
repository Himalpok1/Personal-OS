import { inboxItems } from "@personal-os/db";
import { CaptureRequestSchema, CaptureResponseSchema } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CAPTURE_PARSE_QUEUE } from "../queue-names.js";

// The one rule this route exists to satisfy: raw text lands in Postgres
// before anything else happens, and a 202 is returned immediately (see
// docs/ARCHITECTURE.md, "Write the raw text to Postgres before doing
// anything else"). Never lose a capture because the queue or an upstream
// LLM had a bad minute.
export default function captureRoutes(app: FastifyInstance): void {
  app.post("/capture", async (request, reply) => {
    const body = CaptureRequestSchema.parse(request.body);

    const [inserted] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: body.client_uuid,
        rawText: body.text,
        source: body.source,
        capturedAt: new Date(body.captured_at),
        timezone: body.timezone,
      })
      .onConflictDoNothing({ target: inboxItems.clientUuid })
      .returning({ id: inboxItems.id });

    let inboxId: string;

    if (inserted) {
      inboxId = inserted.id;

      if (app.bossReady) {
        try {
          // singletonKey prevents a second concurrent parse of the same
          // inbox row even if this route is somehow invoked twice for it.
          await app.boss.send(CAPTURE_PARSE_QUEUE, { inboxId }, { singletonKey: inboxId });
        } catch (err) {
          app.log.warn(
            { err, inboxId },
            "capture: failed to enqueue capture.parse; item stays pending",
          );
        }
      } else {
        app.log.warn({ inboxId }, "capture: job queue unavailable; item stays pending");
      }
    } else {
      // client_uuid dedupe hit: the row already exists from a prior
      // (possibly retried) request. Return its id rather than re-enqueuing
      // -- retries must be idempotent end-to-end, not just at the DB layer.
      const [existing] = await app.db
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .where(eq(inboxItems.clientUuid, body.client_uuid));
      if (!existing) {
        throw new Error(
          `client_uuid ${body.client_uuid} conflicted on insert but no existing row was found`,
        );
      }
      inboxId = existing.id;
    }

    await reply.code(202).send(CaptureResponseSchema.parse({ inbox_id: inboxId }));
  });
}
