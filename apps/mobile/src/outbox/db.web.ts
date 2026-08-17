import type { CaptureRequest } from "@personal-os/schema";
import type { OutboxRepository, OutboxRow } from "./types";

const STORAGE_KEY = "personal_os_capture_outbox_v2";

function readRows(): OutboxRow[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as OutboxRow[]) : [];
  } catch {
    return [];
  }
}

function writeRows(rows: OutboxRow[]): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }
}

const repository: OutboxRepository = {
  async enqueue(body: CaptureRequest) {
    const rows = readRows();
    if (rows.some((row) => row.client_uuid === body.client_uuid)) return;
    rows.push({
      client_uuid: body.client_uuid,
      endpoint: "/capture",
      payload: JSON.stringify(body),
      created_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
      next_attempt_at: null,
      permanent: 0,
    });
    writeRows(rows);
  },
  async listReady(now: string) {
    return readRows()
      .filter(
        (row) =>
          row.permanent !== 1 &&
          (row.next_attempt_at == null || row.next_attempt_at <= now),
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  },
  async listPending() {
    return readRows()
      .filter((row) => row.permanent !== 1)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  },
  async delete(clientUuid: string) {
    writeRows(readRows().filter((row) => row.client_uuid !== clientUuid));
  },
  async markFailure(clientUuid, error, nextAttemptAt, permanent) {
    writeRows(
      readRows().map((row) =>
        row.client_uuid === clientUuid
          ? {
              ...row,
              attempts: row.attempts + 1,
              last_error: error,
              next_attempt_at: nextAttemptAt,
              permanent: permanent ? 1 : 0,
            }
          : row,
      ),
    );
  },
  async count() {
    const rows = readRows();
    return {
      pending: rows.filter((row) => row.permanent !== 1).length,
      failed: rows.filter((row) => row.permanent === 1).length,
    };
  },
};

export async function getOutboxRepository(): Promise<OutboxRepository> {
  return repository;
}
