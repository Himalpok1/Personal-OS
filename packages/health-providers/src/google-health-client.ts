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

/**
 * The rollup range. Field names are `start`/`end`, NOT `startTime`/`endTime`.
 *
 * This is a genuine and easy-to-miss asymmetry in the API: the interval carried
 * ON A RECORD (ObservationTimeInterval / SessionTimeInterval) uses
 * startTime/endTime/civilStartTime/civilEndTime, but the CivilTimeInterval used
 * as a rollup REQUEST range uses bare start/end. Getting it wrong produces
 * `Unknown name "startTime" at 'range': Cannot find field` on every rollup call.
 */
export interface ApiCivilTimeInterval {
  /** Inclusive start of the range. */
  start: ApiCivilDateTime;
  /** Exclusive end of the range. */
  end: ApiCivilDateTime;
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

/**
 * Cancellation for one request.
 *
 * The client deliberately imposes NO default timeout of its own. Whether a call
 * may run for 5s or 60s is a scheduling decision belonging to the caller that
 * owns the concurrency budget (the sync limiter), not to the transport. Baking a
 * default in here would silently override that budget and make the real timeout
 * invisible at the call site.
 */
interface AbortableRequest {
  signal?: AbortSignal;
}

export interface DailyRollUpRequest extends AbortableRequest {
  accessToken: string;
  dataType: string;
  range: ApiCivilTimeInterval;
  windowSizeDays?: number;
  /**
   * MUST be the full resource name, e.g.
   * "users/me/dataSourceFamilies/all-sources". A bare "all-sources" is rejected
   * with INVALID_DATA_POINT_DATA_SOURCE_FAMILY. Verified live, 6.2P.
   */
  dataSourceFamily?: string;
}

// NOTE: there is deliberately NO pageSize here.
//
// The REST reference documents pageSize and pageToken as dailyRollUp request
// fields, but sending pageSize AT ALL makes the call fail with HTTP 400 --
// even a small value on a short range, and even well inside the documented
// 90-day cap. Verified live during 6.2P at pageSize 100 and 10000 over a
// 7-day range; removing it alone turned the same request into a 200.
//
// The error is actively misleading: reason INVALID_ROLLUP_QUERY_DURATION with
// metadata maxDurationDays 90, which points at the range rather than at
// pageSize. Omitting the field is the only working shape, so it is made
// unrepresentable rather than left as a trap.

export interface DailyRollUpResponse {
  rollupDataPoints: ApiDailyRollupDataPoint[];
  /**
   * Not documented on dailyRollUp's response even though pageSize/pageToken ARE
   * documented request fields. Typed as optional so the sync engine can detect
   * it if it ever appears in practice, rather than assuming either way.
   */
  nextPageToken?: string;
}

export interface ListRequest extends AbortableRequest {
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

/**
 * One entry of Google's structured `error.details[]`.
 *
 * This is the ONLY machine-readable part of a Google error. `error.message` is
 * prose written for a human and is not a stable contract; `reason` is. 6.2P
 * spent three live attempts misreading a `pageSize` defect as an unsupported
 * metric precisely because the reason was thrown away and only the HTTP status
 * survived.
 *
 * `metadata` is deliberately NOT surfaced on the error: it is a free-form
 * string map whose values are Google's to choose, and a value there could carry
 * a field path, an id or an echoed argument. Reason and domain are the two
 * fields that are enumerable tokens.
 */
export interface ApiErrorDetail {
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}

function dedupe(values: readonly (string | undefined)[]): readonly string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}

export class GoogleHealthApiError extends Error {
  readonly httpStatus: number;
  readonly googleStatus: string | undefined;
  /** Deduped `error.details[].reason`, in the order Google returned them. */
  readonly errorReasons: readonly string[];
  /** Deduped `error.details[].domain`, in the order Google returned them. */
  readonly errorDomains: readonly string[];

  constructor(
    message: string,
    httpStatus: number,
    googleStatus: string | undefined,
    details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "GoogleHealthApiError";
    this.httpStatus = httpStatus;
    this.googleStatus = googleStatus;
    this.errorReasons = dedupe(details.map((d) => d.reason));
    this.errorDomains = dedupe(details.map((d) => d.domain));
  }

  /**
   * 429. Google documents no Retry-After and no X-RateLimit-* headers, so the
   * caller must use blind full-jitter backoff rather than trusting a hint.
   */
  get isRateLimited(): boolean {
    return this.httpStatus === 429;
  }

  /**
   * HTTP 403. NOT by itself evidence of a missing scope -- see
   * sync/capability.ts.
   */
  get isForbidden(): boolean {
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
  error?: { message?: string; status?: string; details?: ApiErrorDetail[] };
}

async function request<T>(
  url: string,
  accessToken: string,
  fetchFn: FetchLike,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchFn(url, {
    ...init,
    ...(signal !== undefined ? { signal } : {}),
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

    // The message is CONSTRUCTED from two enumerable tokens. Google's own
    // error.message is deliberately dropped on the floor and is not retained in
    // any field of the error.
    //
    // This is not caution for its own sake. Google's INVALID_ARGUMENT prose
    // echoes the offending request -- 6.2P saw `Unknown name "startTime" at
    // 'range': Cannot find field` verbatim -- so the message is an
    // attacker-free but caller-controlled channel out of the request body. The
    // worker process has NO log redaction whatsoever, and pg-boss serializes a
    // thrown error into pgboss.job.output, which is a durable table. An echoed
    // filter expression carrying a civil timestamp, or any future request field
    // holding a value, would therefore be written to Postgres in plaintext and
    // to stdout, forever, with nothing in the path to catch it.
    //
    // The machine-readable half of the error is not lost: it moves to
    // errorReasons/errorDomains, which are enumerable tokens, not prose.
    const googleStatus = parsed.error?.status;
    throw new GoogleHealthApiError(
      `Google Health API ${response.status}${googleStatus ? ` ${googleStatus}` : ""}`,
      response.status,
      googleStatus,
      parsed.error?.details ?? [],
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
      // pageSize is intentionally never sent -- see DailyRollUpRequest.
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
        req.signal,
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
        undefined,
        req.signal,
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
        undefined,
        req.signal,
      );
      return {
        dataPoints: body.dataPoints ?? [],
        ...(body.nextPageToken !== undefined ? { nextPageToken: body.nextPageToken } : {}),
      };
    },
  };
}
