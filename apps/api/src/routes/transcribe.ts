import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inboxItems } from "@personal-os/db";
import { CaptureResponseSchema, TranscribeFieldsSchema } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { PTT_TRANSCRIBE_QUEUE } from "../queue-names.js";

// Matches Groq's own upload limit -- see docs/ARCHITECTURE.md's voice
// capture plan.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
};

function extensionForMimeType(mimetype: string | undefined): string {
  if (mimetype && EXTENSION_BY_MIME_TYPE[mimetype]) return EXTENSION_BY_MIME_TYPE[mimetype];
  return ".bin";
}

// The audio front door of the capture pipeline, in spirit alongside
// POST /capture (see docs/ARCHITECTURE.md's worker job table, which lists
// PTT transcription right next to /capture). Kept on the same
// Tailscale-only auth posture as /capture rather than folded into the
// device-token scope -- see the Phase 3 plan's locked decision on auth
// scope (device/notification endpoints only).
//
// Write-before-processing: the inbox_items row (raw_text: null, audio_path
// set) is committed before any transcription work happens, matching this
// project's core capture philosophy -- the capture is never lost because
// Groq had a bad minute, it just sits unprocessed.
export default function transcribeRoutes(app: FastifyInstance): void {
  app.post("/transcribe", async (request, reply) => {
    let fileBuffer: Buffer | undefined;
    let fileMimeType: string | undefined;
    const fields: Record<string, string> = {};

    for await (const part of request.parts({ limits: { fileSize: MAX_AUDIO_BYTES } })) {
      if (part.type === "file") {
        if (part.fieldname !== "audio") continue;
        fileBuffer = await part.toBuffer();
        fileMimeType = part.mimetype;
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!fileBuffer) {
      return reply.code(400).send({
        error: "validation_failed",
        issues: [{ path: ["audio"], message: "an audio file is required" }],
      });
    }

    const body = TranscribeFieldsSchema.parse(fields);

    await mkdir(env.AUDIO_STORAGE_PATH, { recursive: true });
    const audioPath = path.join(
      env.AUDIO_STORAGE_PATH,
      `${randomUUID()}${extensionForMimeType(fileMimeType)}`,
    );
    await writeFile(audioPath, fileBuffer);

    const [inserted] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: body.client_uuid,
        rawText: null,
        source: "ptt",
        audioPath,
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
          // singletonKey prevents a second concurrent transcription of the
          // same inbox row -- same convention as capture.ts's enqueue.
          await app.boss.send(PTT_TRANSCRIBE_QUEUE, { inboxId }, { singletonKey: inboxId });
        } catch (err) {
          app.log.warn(
            { err, inboxId },
            "transcribe: failed to enqueue ptt.transcribe; item stays pending",
          );
        }
      } else {
        app.log.warn({ inboxId }, "transcribe: job queue unavailable; item stays pending");
      }
    } else {
      // client_uuid dedupe hit: an offline-retry of the same capture. The
      // existing row (or its already-in-flight/already-processed audio) is
      // authoritative, not this request's own upload -- delete the file
      // this request just wrote rather than leaving a second, orphaned copy
      // on disk.
      await unlink(audioPath).catch(() => {
        // Best-effort: the required orphan-audio sweep (see
        // apps/worker/src/jobs/sweep-orphan-audio.ts) is the real backstop.
      });
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
