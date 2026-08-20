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
