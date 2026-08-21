import { describe, expect, it } from "vitest";
import { createFakeCalDavClient } from "./caldav-client.fake.js";
import { HttpCalDavClient } from "./caldav-client.js";

describe("CalDavClient & Protocol Mechanics", () => {
  describe("FakeCalDavClient", () => {
    it("discovers home set and lists calendars", async () => {
      const client = createFakeCalDavClient();
      const home = await client.discoverHomeSet("https://caldav.example.com", {
        username: "testuser",
        password: "pw",
      });

      expect(home.principalUrl).toBe("/principals/users/testuser/");
      expect(home.calendarHomeSetUrl).toBe("/calendars/users/testuser/");

      const cals = await client.findCalendars(home.calendarHomeSetUrl, {
        username: "testuser",
        password: "pw",
      });

      expect(cals).toHaveLength(1);
      expect(cals[0]!.displayName).toBe("Personal");
      expect(cals[0]!.href).toBe("/calendars/users/testuser/personal/");
    });

    it("executes initial sync-collection and returns events inventory", async () => {
      const client = createFakeCalDavClient();
      const auth = { username: "testuser", password: "pw" };
      const calHref = "/calendars/users/testuser/personal/";

      // Insert event via putEvent
      const putRes = await client.putEvent(
        `${calHref}meeting.ics`,
        "BEGIN:VCALENDAR\nEND:VCALENDAR",
        undefined,
        auth,
        { ifNoneMatch: true },
      );
      expect(putRes.etag).toBeDefined();

      const syncRes = await client.syncCollection(calHref, undefined, auth);
      expect(syncRes.updated).toHaveLength(1);
      expect(syncRes.updated[0]!.href).toBe(`${calHref}meeting.ics`);
      expect(syncRes.hasMore).toBe(false);
      expect(syncRes.syncToken).toBe("sync-token-2");
    });

    it("handles truncated sync response with continuation loop", async () => {
      const client = createFakeCalDavClient();
      const auth = { username: "testuser", password: "pw" };
      const calHref = "/calendars/users/testuser/personal/";

      // Insert 2 events
      await client.putEvent(
        `${calHref}event1.ics`,
        "BEGIN:VCALENDAR\nEND:VCALENDAR",
        undefined,
        auth,
        { ifNoneMatch: true },
      );
      await client.putEvent(
        `${calHref}event2.ics`,
        "BEGIN:VCALENDAR\nEND:VCALENDAR",
        undefined,
        auth,
        { ifNoneMatch: true },
      );

      client.simulateTruncation = true;

      const firstPage = await client.syncCollection(calHref, undefined, auth);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.updated).toHaveLength(1);

      client.simulateTruncation = false;
      const secondPage = await client.syncCollection(calHref, firstPage.syncToken, auth);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.updated).toHaveLength(2);
    });

    it("enforces optimistic locking (If-Match) on PUT and DELETE", async () => {
      const client = createFakeCalDavClient();
      const auth = { username: "testuser", password: "pw" };
      const eventHref = "/calendars/users/testuser/personal/event1.ics";

      const putRes = await client.putEvent(
        eventHref,
        "BEGIN:VCALENDAR\nEND:VCALENDAR",
        undefined,
        auth,
        { ifNoneMatch: true },
      );
      const originalEtag = putRes.etag;

      // Updating with correct ETag succeeds
      const updateRes = await client.putEvent(
        eventHref,
        "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
        originalEtag,
        auth,
      );
      expect(updateRes.etag).not.toBe(originalEtag);

      // Updating with stale ETag fails with 412
      await expect(
        client.putEvent(eventHref, "BEGIN:VCALENDAR\nNEW\nEND:VCALENDAR", originalEtag, auth),
      ).rejects.toThrow(/ETag mismatch/i);

      // Deleting with stale ETag fails with 412
      await expect(client.deleteEvent(eventHref, originalEtag, auth)).rejects.toThrow(
        /ETag mismatch/i,
      );

      // Deleting with current ETag succeeds
      await client.deleteEvent(eventHref, updateRes.etag, auth);
    });

    it("identifies invalid sync-token and throws CalDavError with isInvalidSyncToken=true", async () => {
      const client = createFakeCalDavClient();
      const auth = { username: "testuser", password: "pw" };
      const calHref = "/calendars/users/testuser/personal/";

      client.forceInvalidSyncToken = true;

      await expect(client.syncCollection(calHref, "stale-sync-token", auth)).rejects.toMatchObject({
        name: "CalDavError",
        isInvalidSyncToken: true,
      });
    });
  });

  describe("HttpCalDavClient SSRF & Redirect Defense", () => {
    it("strips Authorization header on cross-origin redirects", async () => {
      const recordedCalls: Array<{ url: string; headers: Headers }> = [];

      const mockFetch: typeof fetch = (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url =
          typeof input === "string" ? input : "url" in input ? input.url : input.toString();
        const headers = new Headers(init?.headers);
        recordedCalls.push({ url, headers });

        if (url.includes(".well-known")) {
          return Promise.resolve(
            new Response("", {
              status: 302,
              headers: { Location: "https://external-host.com/dav/" },
            }),
          );
        }
        if (url.includes("external-host.com")) {
          return Promise.resolve(
            new Response(
              `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/principals/user/</d:href></d:current-user-principal>
        <c:calendar-home-set><d:href>/calendars/user/</d:href></c:calendar-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`,
              {
                status: 207,
                headers: { "Content-Type": "application/xml" },
              },
            ),
          );
        }
        return Promise.resolve(new Response("<multistatus></multistatus>", { status: 200 }));
      };

      const client = new HttpCalDavClient(mockFetch);
      await client.discoverHomeSet("https://my-caldav.com/dav/", {
        username: "user",
        password: "secret-password",
      });

      expect(recordedCalls.length).toBeGreaterThanOrEqual(2);

      // First call (to my-caldav.com) has Authorization
      const firstCall = recordedCalls[0]!;
      expect(firstCall.headers.get("Authorization")).toBeDefined();

      // Redirected call to cross-origin external-host.com must NOT have Authorization
      const redirectedCall = recordedCalls.find((call) => call.url.includes("external-host.com"));
      expect(redirectedCall).toBeDefined();
      expect(redirectedCall?.headers.get("Authorization")).toBeNull();
    });
  });
});
