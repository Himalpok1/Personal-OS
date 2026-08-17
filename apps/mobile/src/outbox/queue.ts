import { ApiClientError } from "@personal-os/api-client";
import {
  CaptureRequestSchema,
  type CaptureRequest,
  type CaptureResponse,
} from "@personal-os/schema";
import { api } from "@/queries/client";
import { getOutboxRepository } from "./db";
import type { OutboxRepository, OutboxRow } from "./types";

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

let operationChain: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationChain.then(operation, operation);
  operationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermanentDeliveryError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

function nextAttemptAt(attempts: number): string {
  const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** attempts, MAX_RETRY_DELAY_MS);
  return new Date(Date.now() + delay).toISOString();
}

type AttemptResult =
  | { status: "sent"; response: CaptureResponse }
  | { status: "retry" }
  | { status: "permanent"; error: unknown };

async function attemptRow(
  repository: OutboxRepository,
  row: OutboxRow,
): Promise<AttemptResult> {
  if (row.endpoint !== "/capture") {
    const error = new Error(`Unsupported outbox endpoint: ${row.endpoint}`);
    await repository.markFailure(row.client_uuid, error.message, null, true);
    return { status: "permanent", error };
  }

  let body: CaptureRequest;
  try {
    body = CaptureRequestSchema.parse(JSON.parse(row.payload));
  } catch (error) {
    await repository.markFailure(row.client_uuid, errorMessage(error), null, true);
    return { status: "permanent", error };
  }

  try {
    const response = await api.capture(body);
    await repository.delete(row.client_uuid);
    return { status: "sent", response };
  } catch (error) {
    const permanent = isPermanentDeliveryError(error);
    await repository.markFailure(
      row.client_uuid,
      errorMessage(error),
      permanent ? null : nextAttemptAt(row.attempts),
      permanent,
    );
    return permanent ? { status: "permanent", error } : { status: "retry" };
  }
}

// Persist-before-send is the capture durability boundary. Even if the app
// dies after this insert and before the HTTP response, restart flushing
// replays the same client_uuid and the server returns the existing row.
export function enqueueAndAttemptCapture(
  body: CaptureRequest,
): Promise<{ status: "sent"; inbox_id: string } | { status: "queued" }> {
  return serialize(async () => {
    const repository = await getOutboxRepository();
    await repository.enqueue(body);
    const row = (await repository.listReady(new Date().toISOString())).find(
      (candidate) => candidate.client_uuid === body.client_uuid,
    );
    if (!row) return { status: "queued" };

    const result = await attemptRow(repository, row);
    if (result.status === "sent") {
      return { status: "sent", inbox_id: result.response.inbox_id };
    }
    if (result.status === "permanent") throw result.error;
    return { status: "queued" };
  });
}

export function flushOutbox(options: { ignoreBackoff?: boolean } = {}): Promise<{
  flushed: number;
  remaining: number;
  failed: number;
}> {
  return serialize(async () => {
    const repository = await getOutboxRepository();
    const rows = options.ignoreBackoff
      ? await repository.listPending()
      : await repository.listReady(new Date().toISOString());
    let flushed = 0;
    for (const row of rows) {
      const result = await attemptRow(repository, row);
      if (result.status === "sent") flushed += 1;
    }
    const counts = await repository.count();
    return { flushed, remaining: counts.pending, failed: counts.failed };
  });
}

export async function getOutboxStats(): Promise<{ pending: number; failed: number }> {
  return (await getOutboxRepository()).count();
}

export async function getOutboxCount(): Promise<number> {
  const { pending, failed } = await getOutboxStats();
  return pending + failed;
}
