import { describe, expect, it } from "vitest";
import { GoogleSyncTokenExpiredError } from "./google-calendar-client.js";
import {
  FAKE_SYNC_TOKEN_EXPIRED,
  createFakeGoogleCalendarClient,
} from "./google-calendar-client.fake.js";

describe("createFakeGoogleCalendarClient", () => {
  it("returns the fixed calendar list", async () => {
    const client = createFakeGoogleCalendarClient({
      calendars: [{ id: "primary", summary: "Personal", primary: true }],
    });
    const result = await client.listCalendars("token");
    expect(result.items).toEqual([{ id: "primary", summary: "Personal", primary: true }]);
  });

  it("dequeues scripted listEvents responses per-calendar in order, supporting pagination", async () => {
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: {
        primary: [
          {
            items: [
              {
                id: "e1",
                status: "confirmed",
                etag: '"1"',
                updated: "2026-01-01T00:00:00Z",
                iCalUID: "u1",
              },
            ],
            nextPageToken: "page-2",
          },
          {
            items: [
              {
                id: "e2",
                status: "confirmed",
                etag: '"2"',
                updated: "2026-01-01T00:00:00Z",
                iCalUID: "u2",
              },
            ],
            nextSyncToken: "sync-final",
          },
        ],
      },
    });

    const page1 = await client.listEvents("token", { calendarId: "primary" });
    expect(page1.items.map((e) => e.id)).toEqual(["e1"]);
    expect(page1.nextPageToken).toBe("page-2");

    const page2 = await client.listEvents("token", { calendarId: "primary", pageToken: "page-2" });
    expect(page2.items.map((e) => e.id)).toEqual(["e2"]);
    expect(page2.nextSyncToken).toBe("sync-final");

    expect(client.listEventsCalls).toEqual([
      { calendarId: "primary", syncToken: undefined, pageToken: undefined },
      { calendarId: "primary", syncToken: undefined, pageToken: "page-2" },
    ]);
  });

  it("throws GoogleSyncTokenExpiredError when FAKE_SYNC_TOKEN_EXPIRED is queued", async () => {
    const client = createFakeGoogleCalendarClient({
      listEventsQueues: { primary: [FAKE_SYNC_TOKEN_EXPIRED] },
    });

    await expect(
      client.listEvents("token", { calendarId: "primary", syncToken: "stale" }),
    ).rejects.toBeInstanceOf(GoogleSyncTokenExpiredError);
  });

  it("rejects with a clear error when the queue is exhausted", async () => {
    const client = createFakeGoogleCalendarClient();
    await expect(client.listEvents("token", { calendarId: "primary" })).rejects.toThrow(
      /no scripted listEvents response/,
    );
  });

  it("records write calls and echoes input back on insert/update", async () => {
    const client = createFakeGoogleCalendarClient();
    const inserted = await client.insertEvent("token", "primary", { summary: "New event" });
    expect(inserted.summary).toBe("New event");
    expect(inserted.id).toBeTruthy();

    const updated = await client.updateEvent("token", "primary", "existing-id", {
      summary: "Renamed",
    });
    expect(updated.id).toBe("existing-id");
    expect(updated.summary).toBe("Renamed");

    await client.deleteEvent("token", "primary", "existing-id");

    expect(client.writeCalls).toEqual([
      { kind: "insert", calendarId: "primary", event: { summary: "New event" } },
      {
        kind: "update",
        calendarId: "primary",
        eventId: "existing-id",
        event: { summary: "Renamed" },
      },
      { kind: "delete", calendarId: "primary", eventId: "existing-id" },
    ]);
  });

  it("allows enqueueing a response mid-test", async () => {
    const client = createFakeGoogleCalendarClient();
    client.enqueueListEventsResponse("secondary", {
      items: [
        {
          id: "e1",
          status: "confirmed",
          etag: '"1"',
          updated: "2026-01-01T00:00:00Z",
          iCalUID: "u1",
        },
      ],
    });
    const result = await client.listEvents("token", { calendarId: "secondary" });
    expect(result.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 9.5: scripted write failures, recorded insert ids, remote store.
// ---------------------------------------------------------------------------
describe("createFakeGoogleCalendarClient -- write failure scripting", () => {
  it("records the id sent on insert and keeps the event in its remote store", async () => {
    const client = createFakeGoogleCalendarClient();
    const created = await client.insertEvent("t", "primary", { id: "abc123", summary: "x" });
    expect(created.id).toBe("abc123");
    expect(client.insertedIds).toEqual(["abc123"]);
    expect(client.remoteEvents.get("primary/abc123")?.summary).toBe("x");
  });

  it("rejects a second insert with an already-used id as HTTP 409, exactly as Google does", async () => {
    const client = createFakeGoogleCalendarClient();
    await client.insertEvent("t", "primary", { id: "abc123" });
    await expect(client.insertEvent("t", "primary", { id: "abc123" })).rejects.toMatchObject({
      name: "GoogleCalendarApiError",
      httpStatus: 409,
    });
    expect(client.remoteEvents.size).toBe(1);
  });

  it("queueInsertFailure with afterRemoteWrite applies the write and THEN throws -- the lost-response case", async () => {
    const client = createFakeGoogleCalendarClient();
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    client.queueInsertFailure({ error: timeout, afterRemoteWrite: true });

    await expect(client.insertEvent("t", "primary", { id: "abc123" })).rejects.toBe(timeout);
    expect(client.remoteEvents.has("primary/abc123")).toBe(true);
    // The queue is consumed: the next call behaves normally (here: 409, since
    // the id is now taken).
    await expect(client.insertEvent("t", "primary", { id: "abc123" })).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  it("failInsertOnce / failUpdateOnce reject the NEXT call only, without touching the remote store", async () => {
    const client = createFakeGoogleCalendarClient();
    client.failInsertOnce(503);
    await expect(client.insertEvent("t", "primary", { id: "a1" })).rejects.toMatchObject({
      httpStatus: 503,
    });
    expect(client.remoteEvents.size).toBe(0);
    await client.insertEvent("t", "primary", { id: "a1" });
    expect(client.remoteEvents.size).toBe(1);

    client.failUpdateOnce(403, "forbidden");
    await expect(client.updateEvent("t", "primary", "a1", { summary: "y" })).rejects.toMatchObject({
      httpStatus: 403,
      googleReason: "forbidden",
    });
    expect(client.remoteEvents.get("primary/a1")?.summary).toBeUndefined();
  });

  it("updateEvent patches the stored remote event and never renames it", async () => {
    const client = createFakeGoogleCalendarClient();
    await client.insertEvent("t", "primary", { id: "a1", summary: "before", location: "L" });
    const updated = await client.updateEvent("t", "primary", "a1", { id: "zzz", summary: "after" });
    expect(updated.id).toBe("a1");
    expect(client.remoteEvents.get("primary/a1")).toMatchObject({
      summary: "after",
      location: "L",
    });
    expect(client.remoteEvents.has("primary/zzz")).toBe(false);
  });

  it("deleteEvent removes from the remote store; a scripted delete failure leaves it", async () => {
    const client = createFakeGoogleCalendarClient();
    await client.insertEvent("t", "primary", { id: "a1" });
    client.queueDeleteFailure(new Error("boom"));
    await expect(client.deleteEvent("t", "primary", "a1")).rejects.toThrow("boom");
    expect(client.remoteEvents.has("primary/a1")).toBe(true);
    await client.deleteEvent("t", "primary", "a1");
    expect(client.remoteEvents.has("primary/a1")).toBe(false);
  });
});
