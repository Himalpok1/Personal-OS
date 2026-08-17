import { basename } from "node:path";
import { unlink, readFile } from "node:fs/promises";
import {
  NoProviderConfiguredError,
  resolveTranscriptionConnectionForTask,
  transcribeAudio,
} from "@personal-os/ai-providers";
import { inboxItems, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { env } from "../env.js";
import { CAPTURE_PARSE_QUEUE } from "../queue-names.js";

export const VOICE_TRANSCRIBE_TASK_NAME = "voice_transcribe";

export interface PttTranscribeJobData {
  inboxId: string;
}

const EXTENSION_MIME_TYPE: Record<string, string> = {
  ".m4a": "audio/m4a",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
};

function mimeTypeForPath(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXTENSION_MIME_TYPE[ext] ?? "application/octet-stream";
}

// Shared by both the main handler's NoProviderConfiguredError path
// (permanent from the very first attempt, matching capture-parse.ts's
// existing convention for that same error type) and the dead-letter
// handler's retries-exhausted path: mark the inbox item terminally failed
// and delete its source audio -- per the locked decision that a
// permanently-unusable recording shouldn't linger on disk just because
// it's also unrecoverable.
async function finalizeAsFailed(
  db: Db,
  inboxId: string,
  audioPath: string | null,
  errorMessage: string,
): Promise<void> {
  await db
    .update(inboxItems)
    .set({ status: "failed", parseResult: { error: errorMessage }, audioPath: null })
    .where(eq(inboxItems.id, inboxId));
  if (audioPath) {
    await unlink(audioPath).catch((err: unknown) => {
      console.warn(
        `ptt.transcribe: failed to delete audio file ${audioPath} for permanently-failed inbox item ${inboxId}`,
        err,
      );
    });
  }
}

// Idempotency key is presence of audio_path, not attempt count: a
// redelivered job whose audio_path is already null means a prior attempt
// already committed the transcript (or the dead-letter handler already
// finalized it as failed) -- either way, a no-op, not a re-attempt.
export function createPttTranscribeHandler(db: Db, boss: PgBoss) {
  return async function handlePttTranscribe(jobs: Job<PttTranscribeJobData>[]): Promise<void> {
    for (const job of jobs) {
      const { inboxId } = job.data;
      const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
      if (!row) {
        console.warn(`ptt.transcribe: inbox_items ${inboxId} not found, skipping`);
        continue;
      }
      if (row.audioPath === null) continue;
      const audioPath = row.audioPath;

      let resolved;
      try {
        resolved = await resolveTranscriptionConnectionForTask(
          db,
          VOICE_TRANSCRIBE_TASK_NAME,
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
      } catch (err) {
        if (err instanceof NoProviderConfiguredError) {
          // Configuration error, not transient -- do not throw (that would
          // trigger a pointless pg-boss retry/eventual dead-letter cycle
          // for a problem retrying can't fix). Same convention as
          // capture-parse.ts's identical branch.
          await finalizeAsFailed(db, inboxId, audioPath, err.message);
          continue;
        }
        throw err;
      }

      const buffer = await readFile(audioPath);
      const result = await transcribeAudio(resolved, {
        buffer,
        filename: basename(audioPath),
        mimeType: mimeTypeForPath(audioPath),
      });

      // Commit the transcript *before* deleting the file -- a crash
      // between these two steps leaves at worst an orphaned file (cleaned
      // up by the required sweep-orphan-audio cron), never a lost
      // transcript with no recoverable audio.
      await db
        .update(inboxItems)
        .set({ rawText: result.text, audioPath: null })
        .where(eq(inboxItems.id, inboxId));

      await unlink(audioPath).catch((err: unknown) => {
        console.warn(
          `ptt.transcribe: failed to delete audio file ${audioPath} after committing transcript for ${inboxId} -- the orphan sweep will catch it`,
          err,
        );
      });

      // Hands off to the existing, unchanged capture.parse pipeline --
      // this is the only place a transcript becomes a task/note/event,
      // reused rather than duplicated into a second parsing path.
      await boss.send(CAPTURE_PARSE_QUEUE, { inboxId }, { singletonKey: inboxId });
    }
  };
}

// Dead-letter handler: runs only once pg-boss has exhausted every retry
// for a ptt.transcribe job (persistent transient failures -- e.g. Groq
// unreachable for the whole retry window). Re-checks the row's current
// audio_path rather than trusting the job payload alone, since a
// redelivered/duplicate dead-letter job could otherwise double-finalize an
// already-resolved row.
export function createPttTranscribeDeadLetterHandler(db: Db) {
  return async function handlePttTranscribeDead(jobs: Job<PttTranscribeJobData>[]): Promise<void> {
    for (const job of jobs) {
      const { inboxId } = job.data;
      const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
      if (!row || row.audioPath === null) continue;
      await finalizeAsFailed(db, inboxId, row.audioPath, "transcription retries exhausted");
    }
  };
}
