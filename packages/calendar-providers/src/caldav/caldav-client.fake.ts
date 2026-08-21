import type {
  CalDavAuth,
  CalDavCalendarInfo,
  CalDavClient,
  CalDavSyncResult,
} from "./caldav-client.js";
import { CalDavError } from "./caldav-client.js";

export interface FakeCalDavResource {
  href: string;
  etag: string;
  icsData: string;
  updatedAt: Date;
}

export interface FakeCalDavCalendar {
  href: string;
  displayName: string;
  ctag: string;
  syncToken: string;
  supportedComponents: string[];
  supportedReports: string[];
  resources: Map<string, FakeCalDavResource>;
}

export class FakeCalDavClient implements CalDavClient {
  public principalUrl = "/principals/users/testuser/";
  public calendarHomeSetUrl = "/calendars/users/testuser/";
  public calendars = new Map<string, FakeCalDavCalendar>();
  public deletedHrefs = new Map<string, string[]>(); // calendarHref -> deletedHrefs

  public syncTokenCounter = 1;
  public etagCounter = 1;

  // Behavior control hooks for tests
  public forceInvalidSyncToken = false;
  public simulateTruncation = false;
  public simulate412OnPut = false;

  constructor() {
    // Seed default calendar
    const defaultCalHref = "/calendars/users/testuser/personal/";
    this.calendars.set(defaultCalHref, {
      href: defaultCalHref,
      displayName: "Personal",
      ctag: "ctag-1",
      syncToken: "sync-token-1",
      supportedComponents: ["VEVENT"],
      supportedReports: ["sync-collection", "calendar-query", "calendar-multiget"],
      resources: new Map(),
    });
    this.deletedHrefs.set(defaultCalHref, []);
  }

  discoverHomeSet(
    serverUrl?: string,
    auth?: CalDavAuth,
  ): Promise<{ principalUrl: string; calendarHomeSetUrl: string }> {
    void serverUrl;
    void auth;
    return Promise.resolve({
      principalUrl: this.principalUrl,
      calendarHomeSetUrl: this.calendarHomeSetUrl,
    });
  }

  findCalendars(calendarHomeSetUrl?: string, auth?: CalDavAuth): Promise<CalDavCalendarInfo[]> {
    void calendarHomeSetUrl;
    void auth;
    return Promise.resolve(
      Array.from(this.calendars.values()).map((cal) => ({
        href: cal.href,
        displayName: cal.displayName,
        ctag: cal.ctag,
        syncToken: cal.syncToken,
        supportedComponents: cal.supportedComponents,
        supportedReports: cal.supportedReports,
      })),
    );
  }

  syncCollection(
    calendarHref: string,
    syncToken: string | undefined,
    auth?: CalDavAuth,
  ): Promise<CalDavSyncResult> {
    void auth;
    if (this.forceInvalidSyncToken && syncToken) {
      return Promise.reject(new CalDavError("Invalid sync token", 400, undefined, false, true));
    }

    const cal = this.calendars.get(calendarHref);
    if (!cal) {
      return Promise.reject(new CalDavError(`Calendar not found at ${calendarHref}`, 404));
    }

    const resources = Array.from(cal.resources.values());
    const deleted = this.deletedHrefs.get(calendarHref) ?? [];

    this.syncTokenCounter++;
    const nextSyncToken = `sync-token-${this.syncTokenCounter}`;
    cal.syncToken = nextSyncToken;

    if (this.simulateTruncation && resources.length > 1) {
      return Promise.resolve({
        syncToken: nextSyncToken,
        updated: [{ href: resources[0]!.href, etag: resources[0]!.etag }],
        deletedHrefs: [],
        hasMore: true,
      });
    }

    return Promise.resolve({
      syncToken: nextSyncToken,
      updated: resources.map((r) => ({ href: r.href, etag: r.etag })),
      deletedHrefs: [...deleted],
      hasMore: false,
    });
  }

  listEventsInventory(
    calendarHref: string,
    auth?: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string }>> {
    void auth;
    const cal = this.calendars.get(calendarHref);
    if (!cal) {
      return Promise.reject(new CalDavError(`Calendar not found at ${calendarHref}`, 404));
    }
    return Promise.resolve(
      Array.from(cal.resources.values()).map((r) => ({
        href: r.href,
        etag: r.etag,
      })),
    );
  }

  multigetEvents(
    calendarHref: string,
    hrefs: string[],
    auth?: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string; icsData: string }>> {
    void auth;
    const cal = this.calendars.get(calendarHref);
    if (!cal) {
      return Promise.reject(new CalDavError(`Calendar not found at ${calendarHref}`, 404));
    }

    const results: Array<{ href: string; etag: string; icsData: string }> = [];
    for (const href of hrefs) {
      const res = cal.resources.get(href);
      if (res) {
        results.push({
          href: res.href,
          etag: res.etag,
          icsData: res.icsData,
        });
      }
    }
    return Promise.resolve(results);
  }

  getEvent(
    eventHref: string,
    auth?: CalDavAuth,
  ): Promise<{ href: string; etag: string; icsData: string }> {
    void auth;
    for (const cal of this.calendars.values()) {
      const res = cal.resources.get(eventHref);
      if (res) {
        return Promise.resolve({ href: res.href, etag: res.etag, icsData: res.icsData });
      }
    }
    return Promise.reject(new CalDavError(`Event not found at ${eventHref}`, 404));
  }

  putEvent(
    eventHref: string,
    icsData: string,
    etag: string | undefined,
    auth?: CalDavAuth,
    options?: { ifNoneMatch?: boolean },
  ): Promise<{ etag: string }> {
    void auth;
    if (this.simulate412OnPut) {
      return Promise.reject(new CalDavError("Precondition Failed", 412, undefined, true));
    }

    // Find parent calendar by href prefix
    let targetCal: FakeCalDavCalendar | undefined;
    for (const cal of this.calendars.values()) {
      if (eventHref.startsWith(cal.href)) {
        targetCal = cal;
        break;
      }
    }
    if (!targetCal) {
      // Fall back to default
      targetCal = this.calendars.get("/calendars/users/testuser/personal/")!;
    }

    const existing = targetCal.resources.get(eventHref);
    if (options?.ifNoneMatch && existing) {
      return Promise.reject(
        new CalDavError("Resource already exists (If-None-Match)", 412, undefined, true),
      );
    }

    if (etag && existing && existing.etag !== etag.replace(/"/g, "")) {
      return Promise.reject(new CalDavError("ETag mismatch (If-Match)", 412, undefined, true));
    }

    this.etagCounter++;
    const newEtag = `etag-${this.etagCounter}`;
    targetCal.resources.set(eventHref, {
      href: eventHref,
      etag: newEtag,
      icsData,
      updatedAt: new Date(),
    });

    targetCal.ctag = `ctag-${this.etagCounter}`;
    return Promise.resolve({ etag: newEtag });
  }

  deleteEvent(eventHref: string, etag: string | undefined, auth?: CalDavAuth): Promise<void> {
    void auth;
    for (const [calHref, cal] of this.calendars.entries()) {
      const existing = cal.resources.get(eventHref);
      if (existing) {
        if (etag && existing.etag !== etag.replace(/"/g, "")) {
          return Promise.reject(
            new CalDavError("ETag mismatch on DELETE (If-Match)", 412, undefined, true),
          );
        }
        cal.resources.delete(eventHref);
        const deleted = this.deletedHrefs.get(calHref) ?? [];
        deleted.push(eventHref);
        this.deletedHrefs.set(calHref, deleted);
        cal.ctag = `ctag-${++this.etagCounter}`;
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }
}

export function createFakeCalDavClient(): FakeCalDavClient {
  return new FakeCalDavClient();
}
