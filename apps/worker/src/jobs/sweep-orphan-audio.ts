import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { inboxItems, type Db } from "@personal-os/db";
import { isNotNull } from "drizzle-orm";
import { env } from "../env.js";

// Generous relative to STT call latency + ptt.transcribe's full retry
// budget, so a genuinely in-flight transcription's audio is never swept.
const ORPHAN_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// Required, not optional (per the Phase 3 plan review): the crash window
// between committing a transcript (audio_path cleared) or a permanent
// failure and this project's own subsequent unlink() can leave a file on
// disk nothing references -- no amount of step-ordering in
// ptt-transcribe.ts closes that window completely, only bounds it. This
// cron is that bound. Runs on the same nightly-cron registration pattern
// as occurrences.expand-window.
export async function sweepOrphanAudioJob(db: Db): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(env.AUDIO_STORAGE_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // nothing written yet
    throw err;
  }

  const referencedRows = await db
    .select({ audioPath: inboxItems.audioPath })
    .from(inboxItems)
    .where(isNotNull(inboxItems.audioPath));
  const referenced = new Set(
    referencedRows.map((row) => row.audioPath).filter((p): p is string => p !== null),
  );

  const now = Date.now();
  for (const entry of entries) {
    const filePath = path.join(env.AUDIO_STORAGE_PATH, entry);
    if (referenced.has(filePath)) continue;

    const stats = await stat(filePath).catch(() => null);
    if (!stats || !stats.isFile()) continue;
    if (now - stats.mtimeMs < ORPHAN_THRESHOLD_MS) continue;

    await unlink(filePath).catch((err: unknown) => {
      console.warn(`sweep-orphan-audio: failed to delete orphaned file ${filePath}`, err);
    });
  }
}
