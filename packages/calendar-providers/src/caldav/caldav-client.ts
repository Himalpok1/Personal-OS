import { XMLParser } from "fast-xml-parser";
import { isSameOrigin, validateCalDavUrl } from "./ssrf.js";

export interface CalDavAuth {
  username: string;
  password?: string;
  bearerToken?: string;
}

export interface CalDavCalendarInfo {
  href: string;
  displayName: string;
  color?: string;
  ctag?: string;
  syncToken?: string;
  supportedComponents: string[];
  supportedReports: string[];
}

export interface CalDavSyncResult {
  syncToken?: string;
  updated: Array<{ href: string; etag: string }>;
  deletedHrefs: string[];
  hasMore: boolean;
}

export class CalDavError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
    public readonly isConflict: boolean = false,
    public readonly isInvalidSyncToken: boolean = false,
  ) {
    super(message);
    this.name = "CalDavError";
  }
}

export interface CalDavClient {
  discoverHomeSet(
    serverUrl: string,
    auth: CalDavAuth,
  ): Promise<{ principalUrl: string; calendarHomeSetUrl: string }>;

  findCalendars(calendarHomeSetUrl: string, auth: CalDavAuth): Promise<CalDavCalendarInfo[]>;

  syncCollection(
    calendarHref: string,
    syncToken: string | undefined,
    auth: CalDavAuth,
  ): Promise<CalDavSyncResult>;

  listEventsInventory(
    calendarHref: string,
    auth: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string }>>;

  multigetEvents(
    calendarHref: string,
    hrefs: string[],
    auth: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string; icsData: string }>>;

  getEvent(
    eventHref: string,
    auth: CalDavAuth,
  ): Promise<{ href: string; etag: string; icsData: string }>;

  putEvent(
    eventHref: string,
    icsData: string,
    etag: string | undefined,
    auth: CalDavAuth,
    options?: { ifNoneMatch?: boolean },
  ): Promise<{ etag: string }>;

  deleteEvent(eventHref: string, etag: string | undefined, auth: CalDavAuth): Promise<void>;
}

type XmlDict = Record<string, unknown>;

function asDict(val: unknown): XmlDict | undefined {
  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    return val as XmlDict;
  }
  return undefined;
}

function asArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function getVal(dict: XmlDict | undefined, key: string): unknown {
  return dict ? dict[key] : undefined;
}

function getDict(dict: XmlDict | undefined, key: string): XmlDict | undefined {
  return asDict(getVal(dict, key));
}

function getString(dict: XmlDict | undefined, key: string): string | undefined {
  const val = getVal(dict, key);
  return typeof val === "string" ? val : undefined;
}

function getArray(dict: XmlDict | undefined, key: string): unknown[] {
  return asArray(getVal(dict, key));
}

export class HttpCalDavClient implements CalDavClient {
  private parser: XMLParser;

  constructor(private fetchFn: typeof fetch = globalThis.fetch) {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
    });
  }

  private buildAuthHeader(auth: CalDavAuth): string | undefined {
    if (auth.bearerToken) {
      return `Bearer ${auth.bearerToken}`;
    }
    if (auth.username && auth.password !== undefined) {
      const creds = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      return `Basic ${creds}`;
    }
    return undefined;
  }

  private normalizeHref(href: string, baseUri: string): string {
    try {
      const resolved = new URL(href, baseUri);
      return resolved.toString();
    } catch {
      return href;
    }
  }

  private async request(
    urlStr: string,
    options: {
      method: string;
      auth?: CalDavAuth;
      headers?: Record<string, string>;
      body?: string;
      redirectCount?: number;
    },
  ): Promise<{ status: number; headers: Headers; body: string; finalUrl: string }> {
    let currentUrl = validateCalDavUrl(urlStr);
    const initialOrigin = currentUrl.origin;
    let redirectCount = options.redirectCount ?? 0;

    while (true) {
      const headers = new Headers(options.headers || {});
      if (options.auth) {
        if (isSameOrigin(new URL(initialOrigin), new URL(currentUrl.origin))) {
          const authHeader = this.buildAuthHeader(options.auth);
          if (authHeader) headers.set("Authorization", authHeader);
        }
      }

      const response = await this.fetchFn(currentUrl.toString(), {
        method: options.method,
        headers,
        body: options.body,
        redirect: "manual",
      });

      if ([301, 302, 307, 308].includes(response.status)) {
        if (redirectCount >= 5) {
          throw new CalDavError(
            `Too many CalDAV redirects at ${currentUrl.toString()}`,
            response.status,
          );
        }
        redirectCount++;
        const loc = response.headers.get("location");
        if (!loc) {
          throw new CalDavError(
            `Redirect status ${response.status} missing Location header`,
            response.status,
          );
        }
        currentUrl = validateCalDavUrl(new URL(loc, currentUrl).toString());
        continue;
      }

      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: text,
        finalUrl: currentUrl.toString(),
      };
    }
  }

  async discoverHomeSet(
    serverUrl: string,
    auth: CalDavAuth,
  ): Promise<{ principalUrl: string; calendarHomeSetUrl: string }> {
    const validated = validateCalDavUrl(serverUrl);
    let baseUri = validated.origin;

    // 1. Try well-known redirect or direct bootstrap
    let principalUrl: string | undefined;
    const wellKnownRes = await this.request(new URL("/.well-known/caldav", baseUri).toString(), {
      method: "PROPFIND",
      auth,
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    });

    if (wellKnownRes.status === 207 || wellKnownRes.status === 200) {
      baseUri = wellKnownRes.finalUrl;
      const parsed: unknown = this.parser.parse(wellKnownRes.body);
      principalUrl = this.extractPrincipalUrl(parsed, baseUri);
    }

    if (!principalUrl) {
      // PROPFIND on the user-supplied base URL
      const baseRes = await this.request(serverUrl, {
        method: "PROPFIND",
        auth,
        headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
        body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
      });
      if (baseRes.status !== 207 && baseRes.status !== 200) {
        throw new CalDavError(
          `Failed to discover current-user-principal (status ${baseRes.status})`,
          baseRes.status,
          baseRes.body,
        );
      }
      baseUri = baseRes.finalUrl;
      const parsed: unknown = this.parser.parse(baseRes.body);
      principalUrl = this.extractPrincipalUrl(parsed, baseUri);
    }

    if (!principalUrl) {
      throw new CalDavError("Could not find current-user-principal in server response");
    }

    // 2. Discover calendar-home-set on principal URL
    const principalFullUrl = new URL(principalUrl, baseUri).toString();
    const homeSetRes = await this.request(principalFullUrl, {
      method: "PROPFIND",
      auth,
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    });

    if (homeSetRes.status !== 207 && homeSetRes.status !== 200) {
      throw new CalDavError(
        `Failed to discover calendar-home-set on principal ${principalUrl} (status ${homeSetRes.status})`,
        homeSetRes.status,
        homeSetRes.body,
      );
    }

    const homeParsed: unknown = this.parser.parse(homeSetRes.body);
    const calendarHomeSetUrl = this.extractCalendarHomeSet(homeParsed, homeSetRes.finalUrl);
    if (!calendarHomeSetUrl) {
      throw new CalDavError("Could not find calendar-home-set in principal response");
    }

    return { principalUrl, calendarHomeSetUrl };
  }

  private extractPrincipalUrl(parsed: unknown, baseUri: string): string | undefined {
    const multi = getDict(asDict(parsed), "multistatus");
    const responses = getArray(multi, "response");
    for (const r of responses) {
      const propstats = getArray(asDict(r), "propstat");
      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        const principal = getDict(prop, "current-user-principal");
        const href = getString(principal, "href");
        if (typeof href === "string") return this.normalizeHref(href, baseUri);
      }
    }
    return undefined;
  }

  private extractCalendarHomeSet(parsed: unknown, baseUri: string): string | undefined {
    const multi = getDict(asDict(parsed), "multistatus");
    const responses = getArray(multi, "response");
    for (const r of responses) {
      const propstats = getArray(asDict(r), "propstat");
      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        const homeSet = getDict(prop, "calendar-home-set");
        const href = getString(homeSet, "href");
        if (typeof href === "string") return this.normalizeHref(href, baseUri);
      }
    }
    return undefined;
  }

  async findCalendars(calendarHomeSetUrl: string, auth: CalDavAuth): Promise<CalDavCalendarInfo[]> {
    const validated = validateCalDavUrl(calendarHomeSetUrl);
    const res = await this.request(validated.toString(), {
      method: "PROPFIND",
      auth,
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <cs:getctag/>
    <d:sync-token/>
    <c:supported-calendar-component-set/>
    <d:supported-report-set/>
  </d:prop>
</d:propfind>`,
    });

    if (res.status !== 207 && res.status !== 200) {
      throw new CalDavError(
        `Failed to enumerate calendar collections (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    const parsed: unknown = this.parser.parse(res.body);
    const multi = getDict(asDict(parsed), "multistatus");
    const responses = getArray(multi, "response");
    const calendars: CalDavCalendarInfo[] = [];

    for (const r of responses) {
      const rDict = asDict(r);
      const rawHref = getString(rDict, "href");
      if (!rawHref) continue;
      const canonicalHref = this.normalizeHref(rawHref, res.finalUrl);
      const propstats = getArray(rDict, "propstat");

      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        if (!prop) continue;

        const resType = getDict(prop, "resourcetype");
        const isCalendar =
          getVal(resType, "calendar") !== undefined || (resType && "calendar" in resType);
        if (!isCalendar) continue;

        const displayName =
          getString(prop, "displayname") ||
          canonicalHref.split("/").filter(Boolean).pop() ||
          "Calendar";

        const ctag = getString(prop, "getctag");
        const syncToken = getString(prop, "sync-token");

        const compSet = getDict(prop, "supported-calendar-component-set");
        const compArray = getArray(compSet, "comp");
        const supportedComponents = compArray
          .map((c) => {
            const cDict = asDict(c);
            const nameAttr = getString(cDict, "@_name");
            return typeof nameAttr === "string" ? nameAttr : typeof c === "string" ? c : undefined;
          })
          .filter((name): name is string => typeof name === "string");

        const reportSet = getDict(prop, "supported-report-set");
        const reportArray = getArray(reportSet, "report");
        const supportedReports = reportArray
          .map((rep) => {
            const repDict = asDict(rep);
            return repDict ? Object.keys(repDict)[0] : undefined;
          })
          .filter((k): k is string => typeof k === "string" && Boolean(k));

        calendars.push({
          href: canonicalHref,
          displayName,
          ctag,
          syncToken,
          supportedComponents: supportedComponents.length > 0 ? supportedComponents : ["VEVENT"],
          supportedReports,
        });
      }
    }

    return calendars;
  }

  async syncCollection(
    calendarHref: string,
    syncToken: string | undefined,
    auth: CalDavAuth,
  ): Promise<CalDavSyncResult> {
    const validated = validateCalDavUrl(calendarHref);
    const tokenElement = syncToken
      ? `<d:sync-token>${syncToken}</d:sync-token>`
      : `<d:sync-token/>`;

    const res = await this.request(validated.toString(), {
      method: "REPORT",
      auth,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:">
  ${tokenElement}
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
  </d:prop>
</d:sync-collection>`,
    });

    const isInvalidSyncToken =
      res.status === 400 ||
      res.status === 403 ||
      res.status === 507 ||
      res.body.includes("valid-sync-token") ||
      res.body.includes("invalid-sync-token");

    if (isInvalidSyncToken && syncToken !== undefined) {
      throw new CalDavError(
        `Sync token invalid (status ${res.status}): ${res.body}`,
        res.status,
        res.body,
        false,
        true,
      );
    }

    if (res.status !== 207) {
      throw new CalDavError(
        `sync-collection REPORT failed (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    const parsed: unknown = this.parser.parse(res.body);
    const multi = getDict(asDict(parsed), "multistatus");
    const nextSyncToken = getString(multi, "sync-token");

    const responses = getArray(multi, "response");
    const updated: Array<{ href: string; etag: string }> = [];
    const deletedHrefs: string[] = [];

    for (const r of responses) {
      const rDict = asDict(r);
      const rawHref = getString(rDict, "href");
      if (!rawHref) continue;
      const canonicalHref = this.normalizeHref(rawHref, res.finalUrl);
      const statusLine = getString(rDict, "status") || "";

      if (statusLine.includes("404")) {
        deletedHrefs.push(canonicalHref);
        continue;
      }

      const propstats = getArray(rDict, "propstat");
      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        const etag = getString(prop, "getetag");
        if (typeof etag === "string") {
          updated.push({ href: canonicalHref, etag: this.cleanEtag(etag) });
        }
      }
    }

    const hasMore =
      res.body.includes("number-of-matches-within-limits") ||
      responses.some((r) => {
        const rDict = asDict(r);
        const st = getString(rDict, "status");
        return typeof st === "string" && st.includes("507");
      });

    return {
      syncToken: nextSyncToken,
      updated,
      deletedHrefs,
      hasMore,
    };
  }

  async listEventsInventory(
    calendarHref: string,
    auth: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string }>> {
    const validated = validateCalDavUrl(calendarHref);
    const res = await this.request(validated.toString(), {
      method: "PROPFIND",
      auth,
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
    });

    if (res.status !== 207 && res.status !== 200) {
      throw new CalDavError(
        `Failed to list events inventory (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    const parsed: unknown = this.parser.parse(res.body);
    const multi = getDict(asDict(parsed), "multistatus");
    const responses = getArray(multi, "response");
    const inventory: Array<{ href: string; etag: string }> = [];

    for (const r of responses) {
      const rDict = asDict(r);
      const rawHref = getString(rDict, "href");
      if (!rawHref) continue;
      const canonicalHref = this.normalizeHref(rawHref, res.finalUrl);
      if (canonicalHref === this.normalizeHref(calendarHref, res.finalUrl)) {
        continue;
      }

      const propstats = getArray(rDict, "propstat");
      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        const etag = getString(prop, "getetag");
        if (typeof etag === "string") {
          inventory.push({ href: canonicalHref, etag: this.cleanEtag(etag) });
        }
      }
    }

    return inventory;
  }

  async multigetEvents(
    calendarHref: string,
    hrefs: string[],
    auth: CalDavAuth,
  ): Promise<Array<{ href: string; etag: string; icsData: string }>> {
    if (hrefs.length === 0) return [];
    const validated = validateCalDavUrl(calendarHref);
    const hrefElements = hrefs.map((h) => `<d:href>${h}</d:href>`).join("\n");

    const res = await this.request(validated.toString(), {
      method: "REPORT",
      auth,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  ${hrefElements}
</c:calendar-multiget>`,
    });

    if (res.status !== 207 && res.status !== 200) {
      throw new CalDavError(
        `calendar-multiget REPORT failed (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    const parsed: unknown = this.parser.parse(res.body);
    const multi = getDict(asDict(parsed), "multistatus");
    const responses = getArray(multi, "response");
    const results: Array<{ href: string; etag: string; icsData: string }> = [];

    for (const r of responses) {
      const rDict = asDict(r);
      const rawHref = getString(rDict, "href");
      if (!rawHref) continue;
      const canonicalHref = this.normalizeHref(rawHref, res.finalUrl);
      const propstats = getArray(rDict, "propstat");

      for (const p of propstats) {
        const prop = getDict(asDict(p), "prop");
        const etag = getString(prop, "getetag");
        const icsData = getString(prop, "calendar-data");
        if (typeof etag === "string" && typeof icsData === "string") {
          results.push({
            href: canonicalHref,
            etag: this.cleanEtag(etag),
            icsData,
          });
        }
      }
    }

    return results;
  }

  async getEvent(
    eventHref: string,
    auth: CalDavAuth,
  ): Promise<{ href: string; etag: string; icsData: string }> {
    const validated = validateCalDavUrl(eventHref);
    const res = await this.request(validated.toString(), {
      method: "GET",
      auth,
      headers: { Accept: "text/calendar, application/xml" },
    });

    if (res.status === 404) {
      throw new CalDavError(`CalDAV event not found: ${eventHref}`, 404, res.body);
    }
    if (res.status !== 200) {
      throw new CalDavError(
        `GET CalDAV event failed on ${eventHref} (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    const etag = this.cleanEtag(res.headers.get("etag") ?? "");
    return {
      href: this.normalizeHref(eventHref, res.finalUrl),
      etag,
      icsData: res.body,
    };
  }

  async putEvent(
    eventHref: string,
    icsData: string,
    etag: string | undefined,
    auth: CalDavAuth,
    options?: { ifNoneMatch?: boolean },
  ): Promise<{ etag: string }> {
    const validated = validateCalDavUrl(eventHref);
    const headers: Record<string, string> = {
      "Content-Type": "text/calendar; charset=utf-8",
    };

    if (options?.ifNoneMatch) {
      headers["If-None-Match"] = "*";
    } else if (etag) {
      headers["If-Match"] = etag.startsWith('"') ? etag : `"${etag}"`;
    }

    const res = await this.request(validated.toString(), {
      method: "PUT",
      auth,
      headers,
      body: icsData,
    });

    if (res.status === 412) {
      throw new CalDavError(
        `Conditional PUT failed (412 Precondition Failed) on ${eventHref}`,
        412,
        res.body,
        true,
      );
    }

    if (![200, 201, 204].includes(res.status)) {
      throw new CalDavError(
        `PUT event failed on ${eventHref} (status ${res.status})`,
        res.status,
        res.body,
      );
    }

    let returnedEtag = this.cleanEtag(res.headers.get("etag") ?? "");
    if (!returnedEtag) {
      const fetched = await this.getEvent(eventHref, auth);
      returnedEtag = fetched.etag;
    }

    return { etag: returnedEtag };
  }

  async deleteEvent(eventHref: string, etag: string | undefined, auth: CalDavAuth): Promise<void> {
    const validated = validateCalDavUrl(eventHref);
    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-Match"] = etag.startsWith('"') ? etag : `"${etag}"`;
    }

    const res = await this.request(validated.toString(), {
      method: "DELETE",
      auth,
      headers,
    });

    if (res.status === 404) return;
    if (res.status === 412) {
      throw new CalDavError(
        `Conditional DELETE failed (412 Precondition Failed) on ${eventHref}`,
        412,
        res.body,
        true,
      );
    }

    if (![200, 204].includes(res.status)) {
      throw new CalDavError(
        `DELETE event failed on ${eventHref} (status ${res.status})`,
        res.status,
        res.body,
      );
    }
  }

  private cleanEtag(etag: string): string {
    return etag.replace(/^W\//, "").replace(/^"/, "").replace(/"$/, "");
  }
}

export function createCalDavClient(fetchFn?: typeof fetch): CalDavClient {
  return new HttpCalDavClient(fetchFn);
}
