import * as SQLite from "expo-sqlite";

// Capture/quick-add only (locked Phase 3 decision) -- see
// docs/ARCHITECTURE.md's "Offline: outbox pattern only" section for the
// documented schema this mirrors: (client_uuid, endpoint, payload,
// created_at, attempts, last_error). `endpoint` is currently always
// "/capture" but is kept as a real column rather than hardcoded, matching
// the architecture doc's schema exactly rather than a narrower one-off
// shape.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getOutboxDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("outbox.db").then(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        client_uuid TEXT PRIMARY KEY NOT NULL,
        endpoint TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `);
    return db;
  });
  return dbPromise;
}
