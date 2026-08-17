import { ApiClientError } from "@personal-os/api-client";
import type { CaptureRequest } from "@personal-os/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxRepository, OutboxRow } from "./types";

const { captureMock, getRepositoryMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  getRepositoryMock: vi.fn(),
}));

vi.mock("@/queries/client", () => ({ api: { capture: captureMock } }));
vi.mock("./db", () => ({ getOutboxRepository: getRepositoryMock }));

const { enqueueAndAttemptCapture, flushOutbox } = await import("./queue");

const BODY: CaptureRequest = {
  text: "Call mom tomorrow",
  source: "web",
  client_uuid: "11111111-1111-4111-8111-111111111111",
  captured_at: "2026-08-17T12:00:00.000Z",
  timezone: "America/Chicago",
};

const SECOND_BODY: CaptureRequest = {
  ...BODY,
  text: "Buy milk",
  client_uuid: "33333333-3333-4333-8333-333333333333",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memoryRepository(): { repository: OutboxRepository; rows: Map<string, OutboxRow> } {
  const rows = new Map<string, OutboxRow>();
  const repository: OutboxRepository = {
    async enqueue(body) {
      if (rows.has(body.client_uuid)) return;
      rows.set(body.client_uuid, {
        client_uuid: body.client_uuid,
        endpoint: "/capture",
        payload: JSON.stringify(body),
        created_at: new Date().toISOString(),
        attempts: 0,
        last_error: null,
        next_attempt_at: null,
        permanent: 0,
      });
    },
    async listReady(now) {
      return [...rows.values()].filter(
        (row) =>
          row.permanent === 0 &&
          (row.next_attempt_at === null || row.next_attempt_at <= now),
      );
    },
    async listPending() {
      return [...rows.values()].filter((row) => row.permanent === 0);
    },
    async delete(clientUuid) {
      rows.delete(clientUuid);
    },
    async markFailure(clientUuid, error, nextAttemptAt, permanent) {
      const row = rows.get(clientUuid);
      if (!row) return;
      rows.set(clientUuid, {
        ...row,
        attempts: row.attempts + 1,
        last_error: error,
        next_attempt_at: nextAttemptAt,
        permanent: permanent ? 1 : 0,
      });
    },
    async count() {
      const values = [...rows.values()];
      return {
        pending: values.filter((row) => row.permanent === 0).length,
        failed: values.filter((row) => row.permanent === 1).length,
      };
    },
  };
  return { repository, rows };
}

describe("capture outbox", () => {
  beforeEach(() => {
    vi.useRealTimers();
    captureMock.mockReset();
    getRepositoryMock.mockReset();
  });

  it("persists the capture before making the first HTTP attempt", async () => {
    const { repository, rows } = memoryRepository();
    getRepositoryMock.mockResolvedValue(repository);
    captureMock.mockImplementation(async () => {
      expect(rows.has(BODY.client_uuid)).toBe(true);
      return { inbox_id: "22222222-2222-4222-8222-222222222222" };
    });

    await expect(enqueueAndAttemptCapture(BODY)).resolves.toEqual({
      status: "sent",
      inbox_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(rows.size).toBe(0);
  });

  it("keeps a transient failure and replays the identical client_uuid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const { repository, rows } = memoryRepository();
    getRepositoryMock.mockResolvedValue(repository);
    captureMock
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ inbox_id: "22222222-2222-4222-8222-222222222222" });

    await expect(enqueueAndAttemptCapture(BODY)).resolves.toEqual({ status: "queued" });
    expect(rows.get(BODY.client_uuid)?.attempts).toBe(1);

    vi.advanceTimersByTime(5_001);
    await expect(flushOutbox()).resolves.toMatchObject({ flushed: 1, remaining: 0 });
    expect(captureMock.mock.calls.map(([body]) => body.client_uuid)).toEqual([
      BODY.client_uuid,
      BODY.client_uuid,
    ]);
  });

  it("marks a permanent client error without retrying it forever", async () => {
    const { repository, rows } = memoryRepository();
    getRepositoryMock.mockResolvedValue(repository);
    captureMock.mockRejectedValue(new ApiClientError(400, "validation_failed"));

    await expect(enqueueAndAttemptCapture(BODY)).rejects.toThrow(/validation_failed/);
    expect(rows.get(BODY.client_uuid)?.permanent).toBe(1);
    await expect(flushOutbox()).resolves.toMatchObject({ flushed: 0, failed: 1 });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses a stale offline backoff when connectivity returns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const { repository, rows } = memoryRepository();
    getRepositoryMock.mockResolvedValue(repository);
    captureMock
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ inbox_id: "22222222-2222-4222-8222-222222222222" });

    await expect(enqueueAndAttemptCapture(BODY)).resolves.toEqual({ status: "queued" });
    expect(rows.get(BODY.client_uuid)?.next_attempt_at).not.toBeNull();

    await expect(flushOutbox({ ignoreBackoff: true })).resolves.toMatchObject({
      flushed: 1,
      remaining: 0,
    });
    expect(captureMock).toHaveBeenCalledTimes(2);
  });

  it("serializes overlapping operations and continues after an earlier failure", async () => {
    const firstDelivery = deferred<{ inbox_id: string }>();
    const { repository, rows } = memoryRepository();
    getRepositoryMock.mockResolvedValue(repository);
    captureMock
      .mockImplementationOnce(() => firstDelivery.promise)
      .mockResolvedValueOnce({ inbox_id: "44444444-4444-4444-8444-444444444444" });

    const first = enqueueAndAttemptCapture(BODY);
    const second = enqueueAndAttemptCapture(SECOND_BODY);

    await vi.waitFor(() => expect(captureMock).toHaveBeenCalledTimes(1));
    expect([...rows.keys()]).toEqual([BODY.client_uuid]);
    expect(captureMock.mock.calls[0]?.[0].client_uuid).toBe(BODY.client_uuid);

    firstDelivery.reject(new ApiClientError(400, "first_failed"));

    await expect(first).rejects.toThrow(/first_failed/);
    await expect(second).resolves.toEqual({
      status: "sent",
      inbox_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(captureMock.mock.calls.map(([body]) => body.client_uuid)).toEqual([
      BODY.client_uuid,
      SECOND_BODY.client_uuid,
    ]);
    expect(rows.get(BODY.client_uuid)?.permanent).toBe(1);
    expect(rows.has(SECOND_BODY.client_uuid)).toBe(false);
  });
});
