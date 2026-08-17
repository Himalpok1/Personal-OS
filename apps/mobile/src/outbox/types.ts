import type { CaptureRequest } from "@personal-os/schema";

export interface OutboxRow {
  client_uuid: string;
  endpoint: string;
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  permanent: number;
}

export interface OutboxRepository {
  enqueue(body: CaptureRequest): Promise<void>;
  listReady(now: string): Promise<OutboxRow[]>;
  listPending(): Promise<OutboxRow[]>;
  delete(clientUuid: string): Promise<void>;
  markFailure(
    clientUuid: string,
    error: string,
    nextAttemptAt: string | null,
    permanent: boolean,
  ): Promise<void>;
  count(): Promise<{ pending: number; failed: number }>;
}
