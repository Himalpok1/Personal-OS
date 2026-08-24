import type { FetchLike } from "./google-health-oauth.js";

// Typed client for the Google Health REST API (v4).
//
// Hand-rolled fetch rather than googleapis: it matches this repo's existing
// provider convention, adds no dependency, and keeps the surface to exactly the
// four methods Phase 6A uses.
//
// fetchFn is INJECTABLE, following packages/calendar-providers' CalDAV client
// rather than its Google Calendar client -- the latter closes over a
// module-scope fetch and consequently has no test file at all. That is a
// mistake worth not repeating.

export const HEALTH_API_BASE = "https://health.googleapis.com/v4";

export interface GoogleHealthIdentity {
  healthUserId: string;
  legacyUserId: string | null;
}

/** A civil (offset-less) date-time as the API represents it. */
export interface ApiCivilDateTime {
  date: { year: number; month: number; day: number };
  time?: { hours?: number; minutes?: number; seconds?: number; nanos?: number };
}

export interface ApiCivilTimeInterval {
  startTime: ApiCivilDateTime;
  endTime: ApiCivilDateTime;
}

/** Shape returned by dailyRollUp. Note: NO physical instants, NO UTC offsets. */
export interface ApiDailyRollupDataPoint {
  civilStartTime: ApiCivilDateTime;
  civilEndTime: ApiCivilDateTime;
  [valueField: string]: unknown;
}

export interface ApiDataPoint {
  name?: string;
  dataSource?: {
    recordingMethod?: string;
    device?: { formFactor?: string };
    application?: { platform?: string };
  };
  [valueField: string]: unknown;
}

export interface DailyRollUpRequest {
  accessToken: string;
  dataType: string;
  range: ApiCivilTimeInterval;
  windowSizeDays?: number;
  pageSize?: number;
  dataSourceFamily?: string;
}

export interface DailyRollUpResponse {
  rollupDataPoints: ApiDailyRollupDataPoint[];
  /**
   * Not documented on dailyRollUp's response even though pageSize/pageToken ARE
   * documented request fields. Typed as optional so the sync engine can detect
   * it if it ever appears in practice, rather than assuming either way.
   */
  nextPageToken?: string;
}

export interface ListRequest {
  accessToken: string;
  dataType: string;
  filter: string;
  pageSize?: number;
  pageToken?: string;
}

/** reconcile is the only sample method that accepts dataSourceFamily. */
export interface ReconcileRequest extends ListRequest {
  dataSourceFamily?: string;
}

export interface DataPointPage {
  dataPoints: ApiDataPoint[];
  nextPageToken?: string;
}

export interface GoogleHealthClient {
  getIdentity(accessToken: string): Promise<GoogleHealthIdentity>;
  dailyRollUp(request: DailyRollUpRequest): Promise<DailyRollUpResponse>;
  list(request: ListRequest): Promise<DataPointPage>;
  reconcile(request: ReconcileRequest): Promise<DataPointPage>;
}

export class GoogleHealthApiError extends Error {
  readonly httpStatus: number;
  readonly googleStatus: string | undefined;

  constructor(message: string, httpStatus: number, googleStatus: string | undefined) {
    super(message);
    this.name = "GoogleHealthApiError";
    this.httpStatus = httpStatus;
    this.googleStatus = googleStatus;
  }

  /**
   * 429. Google documents no Retry-After and no X-RateLimit-* headers, so the
   * caller must use blind full-jitter backoff rather than trusting a hint.
   */
  get isRateLimited(): boolean {
    return this.httpStatus === 429;
  }

  /** A scope the user did not grant. Permanent for this stream, not the connection. */
  get isScopeDenied(): boolean {
    return this.httpStatus === 403;
  }

  /** The grant itself is dead -- the connection needs re-authorization. */
  get isAuthFailure(): boolean {
    return this.httpStatus === 401;
  }

  /** Worth retrying: transport hiccups and Google-side faults. */
  get isTransient(): boolean {
    return this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

interface ApiErrorBody {
  error?: { message?: string; status?: string };
}

async function request<T>(
  url: string,
  accessToken: string,
  fetchFn: FetchLike,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchFn(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let parsed: ApiErrorBody = {};
    try {
      parsed = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error body.
    }
    // The message is Google's, never ours plus a value: health values and
    // credentials must never reach a log through an error string.
    throw new GoogleHealthApiError(
      parsed.error?.message ?? `Google Health API returned HTTP ${response.status}`,
      response.status,
      parsed.error?.status,
    );
  }

  return (await response.json()) as T;
}

export function createGoogleHealthClient(
  fetchFn: FetchLike = globalThis.fetch,
): GoogleHealthClient {
  return {
    async getIdentity(accessToken) {
      const body = await request<{ healthUserId?: string; legacyUserId?: string }>(
        `${HEALTH_API_BASE}/users/me/identity`,
        accessToken,
        fetchFn,
      );
      if (!body.healthUserId) {
        throw new GoogleHealthApiError(
          "users.getIdentity returned no healthUserId",
          500,
          undefined,
        );
      }
      return { healthUserId: body.healthUserId, legacyUserId: body.legacyUserId ?? null };
    },

    async dailyRollUp(req) {
      const payload: Record<string, unknown> = {
        range: req.range,
        windowSizeDays: req.windowSizeDays ?? 1,
      };
      if (req.pageSize !== undefined) payload["pageSize"] = req.pageSize;
      if (req.dataSourceFamily !== undefined) payload["dataSourceFamily"] = req.dataSourceFamily;

      const body = await request<Partial<DailyRollUpResponse>>(
        `${HEALTH_API_BASE}/users/me/dataTypes/${req.dataType}/dataPoints:dailyRollUp`,
        req.accessToken,
        fetchFn,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return {
        rollupDataPoints: body.rollupDataPoints ?? [],
        ...(body.nextPageToken !== undefined ? { nextPageToken: body.nextPageToken } : {}),
      };
    },

    async list(req) {
      // dataType is kebab-case in the PATH; the filter uses snake_case. Getting
      // these the wrong way round is the documented trap.
      const query = new URLSearchParams({ filter: req.filter });
      if (req.pageSize !== undefined) query.set("pageSize", String(req.pageSize));
      if (req.pageToken !== undefined) query.set("pageToken", req.pageToken);
      const body = await request<Partial<DataPointPage>>(
        `${HEALTH_API_BASE}/users/me/dataTypes/${req.dataType}/dataPoints?${query.toString()}`,
        req.accessToken,
        fetchFn,
      );
      return {
        dataPoints: body.dataPoints ?? [],
        ...(body.nextPageToken !== undefined ? { nextPageToken: body.nextPageToken } : {}),
      };
    },

    async reconcile(req) {
      const query = new URLSearchParams({ filter: req.filter });
      if (req.pageSize !== undefined) query.set("pageSize", String(req.pageSize));
      if (req.pageToken !== undefined) query.set("pageToken", req.pageToken);
      if (req.dataSourceFamily !== undefined) {
        query.set("dataSourceFamily", req.dataSourceFamily);
      }
      const body = await request<Partial<DataPointPage>>(
        `${HEALTH_API_BASE}/users/me/dataTypes/${req.dataType}/dataPoints:reconcile?${query.toString()}`,
        req.accessToken,
        fetchFn,
      );
      return {
        dataPoints: body.dataPoints ?? [],
        ...(body.nextPageToken !== undefined ? { nextPageToken: body.nextPageToken } : {}),
      };
    },
  };
}
