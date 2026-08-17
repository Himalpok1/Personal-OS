import type { CaptureRequest } from "@personal-os/schema";
import * as SQLite from "expo-sqlite";
import type { OutboxRepository, OutboxRow } from "./types";

let repositoryPromise: Promise<OutboxRepository> | null = null;

export function getOutboxRepository(): Promise<OutboxRepository> {
  repositoryPromise ??= SQLite.openDatabaseAsync("outbox.db").then(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        client_uuid TEXT PRIMARY KEY NOT NULL,
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT,
        permanent INTEGER NOT NULL DEFAULT 0
      );
    `);

    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(outbox)");
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("next_attempt_at")) {
      await db.execAsync("ALTER TABLE outbox ADD COLUMN next_attempt_at TEXT");
    }
    if (!columnNames.has("permanent")) {
      await db.execAsync("ALTER TABLE outbox ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0");
    }

    return {
      async enqueue(body: CaptureRequest) {
        await db.runAsync(
          "INSERT OR IGNORE INTO outbox (client_uuid, endpoint, payload, created_at, attempts, last_error, next_attempt_at, permanent) VALUES (?, ?, ?, ?, 0, NULL, NULL, 0)",
          [body.client_uuid, "/capture", JSON.stringify(body), new Date().toISOString()],
        );
      },
      listReady(now: string) {
        return db.getAllAsync<OutboxRow>(
          "SELECT * FROM outbox WHERE permanent = 0 AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC",
          [now],
        );
      },
      listPending() {
        return db.getAllAsync<OutboxRow>(
          "SELECT * FROM outbox WHERE permanent = 0 ORDER BY created_at ASC",
        );
      },
      async delete(clientUuid: string) {
        await db.runAsync("DELETE FROM outbox WHERE client_uuid = ?", [clientUuid]);
      },
      async markFailure(clientUuid, error, nextAttemptAt, permanent) {
        await db.runAsync(
          "UPDATE outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, permanent = ? WHERE client_uuid = ?",
          [error, nextAttemptAt, permanent ? 1 : 0, clientUuid],
        );
      },
      async count() {
        const rows = await db.getAllAsync<{ permanent: number; count: number }>(
          "SELECT permanent, COUNT(*) AS count FROM outbox GROUP BY permanent",
        );
        return {
          pending: rows.find((row) => row.permanent === 0)?.count ?? 0,
          failed: rows.find((row) => row.permanent === 1)?.count ?? 0,
        };
      },
    };
  });
  return repositoryPromise;
}
