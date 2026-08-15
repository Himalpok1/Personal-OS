import { type Db, workerHeartbeat } from "@personal-os/db";

// Upserts the singleton row so a dead worker is observable via /health.
export async function recordHeartbeat(db: Db): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ id: 1, lastBeatAt: new Date(), status: "ok" })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { lastBeatAt: new Date(), status: "ok" },
    });
}
