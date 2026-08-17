import type { CaptureRequest } from "@personal-os/schema";
import { api } from "@/queries/client";
import { getOutboxDb } from "./db";

interface OutboxRow {
  client_uuid: string;
  endpoint: string;
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

// Queues a capture for later delivery. INSERT OR IGNORE on the client_uuid
// primary key -- an offline-retry of the same capture (e.g. the user tapped
// submit twice while offline) is a silent no-op here, matching the same
// client_uuid-dedupe contract POST /capture itself already provides
// server-side.
export async function enqueueCapture(body: CaptureRequest): Promise<void> {
  const db = await getOutboxDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO outbox (client_uuid, endpoint, payload, created_at, attempts, last_error) VALUES (?, ?, ?, ?, 0, NULL)",
    [body.client_uuid, "/capture", JSON.stringify(body), new Date().toISOString()],
  );
}

export async function getOutboxCount(): Promise<number> {
  const db = await getOutboxDb();
  const rows = await db.getAllAsync<{ count: number }>("SELECT COUNT(*) as count FROM outbox");
  return rows[0]?.count ?? 0;
}

// Attempts to deliver every queued row, oldest first. A row is removed only
// on a real server acknowledgement -- a failed attempt increments
// `attempts`/records `last_error` and stays queued for the next flush
// (triggered by reconnect or app foreground; see
// use-outbox-flush-on-reconnect.ts). Delivery reuses client_uuid dedupe, so
// a row that actually succeeded server-side on a prior attempt but whose
// response was lost (e.g. connection dropped mid-flush) is not
// double-captured on retry.
export async function flushOutbox(): Promise<{ flushed: number; remaining: number }> {
  const db = await getOutboxDb();
  const rows = await db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY created_at ASC");

  let flushed = 0;
  for (const row of rows) {
    try {
      const body = JSON.parse(row.payload) as CaptureRequest;
      await api.capture(body);
      await db.runAsync("DELETE FROM outbox WHERE client_uuid = ?", [row.client_uuid]);
      flushed++;
    } catch (err) {
      await db.runAsync(
        "UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE client_uuid = ?",
        [err instanceof Error ? err.message : String(err), row.client_uuid],
      );
    }
  }

  return { flushed, remaining: await getOutboxCount() };
}
