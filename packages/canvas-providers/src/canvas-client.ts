import {
  CANVAS_API_VERSION_PATH,
  CANVAS_COURSES_PER_PAGE,
  CANVAS_RATE_LIMIT_HEADER,
} from "./canvas-catalog.js";
import { CanvasUrlBlockedError, isSameOrigin, validateCanvasUrl } from "./ssrf.js";

// The provider-facing Canvas LMS client interface and real implementation
// (ADR-068).
//
// Shaped on MailClient (packages/mail-providers/src/mail-client.ts), which
// itself records why it is shaped on the CalDAV/GoogleHealth clients "rather
// than [Google Calendar's], which closes over a module-scope fetch and
// consequently has no test file at all. That is a mistake worth not
// repeating."
//
// ONE IMPLEMENTATION AND ONE FAKE. There is exactly one Canvas provider (the
// owner's own institution's Canvas instance) -- unlike Gmail/Graph, there is
// no second LMS this project has ever considered, so an interface built to
// generalize across providers nobody has implemented would be guesswork
// (the same call mail-providers makes about Microsoft Graph).
//
// UNLIKE MailClient, `baseUrl` is a PER-CALL argument here rather than a
// package-level constant. Gmail's API origin (`GMAIL_API_BASE`) is the same
// for every mailbox on earth; Canvas is self-hosted per institution, so
// `https://uta.instructure.com` is connection-specific configuration this
// package cannot bake in. `token` is likewise per-call, exactly as
// `accessToken` is on `MailClient` -- a worker iterating `canvas_connections`
// passes each connection's own decrypted Personal Access Token.
//
// EVERY METHOD IS A SINGLE-PAGE PRIMITIVE, mirroring `MailClient`'s rule: it
// fetches exactly one page (`per_page=100`) and never follows a `Link`
// header. Whether a second page is ever worth fetching for one student's
// course load is a sync-engine budget decision, not a transport one.
//
// READ-ONLY BY CONSTRUCTION (ADR-068 §6). There is no method here that could
// submit an assignment, reply to an announcement or change a course setting
// -- the interface cannot express a write, which is a stronger guarantee
// than a policy saying not to issue one.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `GET /users/self`. Confirms the token is valid and identifies the owner.
 *
 * Typed loosely and deliberately not `.strict()`: Canvas returns dozens of
 * fields (avatar URLs, locale, LTI ids, `permissions`...) this integration
 * has no functional use for and therefore never reads. Only `id`, `name` and
 * `short_name` (ADR-068) are ever consumed downstream.
 */
export interface CanvasSelfResponse {
  id: number | string;
  name?: string | null;
  short_name?: string | null;
  [key: string]: unknown;
}

/** `courses[].term`, present only because the request carries `include[]=term`. */
export interface CanvasTermApiShape {
  id?: number | string;
  name?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  [key: string]: unknown;
}

/**
 * `courses[].enrollments[]`. Only `enrollments[0].enrollment_state` is ever
 * read (ADR-068) -- the enrollment type, role, grades and every other field
 * on this shape are ignored by `translate.ts`.
 */
export interface CanvasEnrollmentApiShape {
  enrollment_state?: string | null;
  [key: string]: unknown;
}

/**
 * `GET /courses`. Typed loosely on purpose: Canvas's course resource also
 * carries `uuid`, `license`, `calendar.ics`, `storage_quota_mb`,
 * blueprint/template flags, `is_public*` and every account/root-account id --
 * ADR-068's field-by-field "does this need to exist locally" pass excluded
 * every one of those before schema design, and this type mirrors that by
 * simply never declaring the fields it would take to read them.
 */
export interface CanvasCourseApiShape {
  id: number | string;
  name?: string | null;
  course_code?: string | null;
  term?: CanvasTermApiShape | null;
  enrollments?: CanvasEnrollmentApiShape[] | null;
  workflow_state?: string | null;
  html_url?: string | null;
  [key: string]: unknown;
}

/**
 * `assignments[].submission`, present only because the request carries
 * `include[]=submission`.
 *
 * `score`/`grade`/`entered_score`/`entered_grade`/`attachments` ARE real,
 * populated fields on the wire -- ADR-068's live probe confirmed it -- and
 * are declared here because that is genuinely what Canvas returns. They are
 * excluded at TRANSLATION (`translate.ts`), not at the type: this checkpoint
 * draws the line at "what Personal OS stores", not "what Canvas returns", so
 * a wire type that hid them would misrepresent what this client actually
 * receives over the network.
 */
export interface CanvasSubmissionApiShape {
  workflow_state?: string | null;
  missing?: boolean | null;
  late?: boolean | null;
  submitted_at?: string | null;
  score?: number | null;
  grade?: string | null;
  entered_score?: number | null;
  entered_grade?: string | null;
  attachments?: unknown[] | null;
  [key: string]: unknown;
}

/**
 * `GET /courses/:id/assignments`. `description` is declared here -- it is a
 * real field on the wire -- but `translate.ts` never reads it: ADR-068
 * excludes an assignment's rich-text prompt from storage entirely, and
 * `html_url` is the one-tap deep link back to the full prompt instead.
 */
export interface CanvasAssignmentApiShape {
  id: number | string;
  name?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[] | null;
  html_url?: string | null;
  published?: boolean | null;
  workflow_state?: string | null;
  submission?: CanvasSubmissionApiShape | null;
  description?: string | null;
  [key: string]: unknown;
}

/** `GET /announcements`. */
export interface CanvasAnnouncementApiShape {
  id: number | string;
  title?: string | null;
  message?: string | null;
  posted_at?: string | null;
  html_url?: string | null;
  read_state?: string | null;
  context_code?: string | null;
  [key: string]: unknown;
}

/** `GET /calendar_events?type=event`. */
export interface CanvasCalendarEventApiShape {
  id: number | string;
  title?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean | null;
  location_name?: string | null;
  html_url?: string | null;
  [key: string]: unknown;
}

/**
 * Every operation this checkpoint may perform. Read-only, by construction --
 * there is no create/update/delete method here and there never will be under
 * ADR-068: Canvas is read from, never acted on.
 */
export interface CanvasClient {
  getSelf(baseUrl: string, token: string, signal?: AbortSignal): Promise<CanvasSelfResponse>;
  listActiveCourses(
    baseUrl: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<CanvasCourseApiShape[]>;
  listAssignments(
    baseUrl: string,
    token: string,
    courseId: string | number,
    signal?: AbortSignal,
  ): Promise<CanvasAssignmentApiShape[]>;
  listAnnouncements(
    baseUrl: string,
    token: string,
    courseId: string | number,
    signal?: AbortSignal,
  ): Promise<CanvasAnnouncementApiShape[]>;
  listCalendarEvents(
    baseUrl: string,
    token: string,
    courseId: string | number,
    signal?: AbortSignal,
  ): Promise<CanvasCalendarEventApiShape[]>;
}

/**
 * A Canvas API failure, carrying only enumerable machine-readable facts.
 *
 * THE PROVIDER'S RESPONSE BODY IS NEVER STORED, PARSED PAST ONE FIXED TOKEN,
 * OR THROWN AS PART OF THE MESSAGE.
 *
 * This is the same rule `GmailApiError` and `GoogleHealthApiError` enforce,
 * for the same reason: the worker process has no log redaction, and pg-boss
 * serializes a thrown error into `pgboss.job.output` -- a durable Postgres
 * table -- by copying every own-enumerable property. A retained message,
 * including an institution-authored error string, is a channel that ends in
 * plaintext in Postgres, forever. `code` is a closed, five-member
 * classification computed once at throw time (see `classifyCanvasHttpStatus`
 * below); nothing downstream needs, or gets, anything richer.
 */
export type CanvasFailureClass =
  | "auth_failed"
  | "rate_limited"
  | "not_found"
  | "provider_error"
  | "network_error"
  // The request was refused before any network call was made -- the base
  // URL (or a redirect target reached from it) failed `validateCanvasUrl`'s
  // SSRF/cloud-metadata check. Never retryable: retrying sends the same
  // blocked request again.
  | "blocked_url";

export class CanvasApiError extends Error {
  readonly httpStatus: number;
  readonly code: CanvasFailureClass;

  constructor(httpStatus: number, code: CanvasFailureClass) {
    super(`Canvas API ${httpStatus} (${code})`);
    this.name = "CanvasApiError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/** The one field this client ever reads off an error body -- see below. */
interface CanvasErrorBody {
  status?: string;
}

function parseRateLimitRemaining(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reduces an HTTP failure to one of the five closed classes.
 *
 * Canvas overloads 403 for both a dead/insufficient Personal Access Token and
 * rate limiting. A throttled response carries a documented, FIXED-VOCABULARY
 * `status` token -- `"rate limit exceeded"`, never free prose -- which is the
 * same safe-token comparison `GmailApiError` makes against `error.status`;
 * `X-Rate-Limit-Remaining: 0` corroborates the same fact from the header
 * side, since Canvas can send either signal alone. Neither the body's
 * `errors[].message` nor any other free-text field is ever read here.
 *
 * There is no per-operation branch (unlike Gmail's 404, which means something
 * different on `history.list` than on `messages.get`): every endpoint this
 * package calls means "not found" and nothing else on a 404, because a PAT
 * carries no cursor and no OAuth grant that could expire mid-request.
 */
function classifyCanvasHttpStatus(
  httpStatus: number,
  bodyStatus: string | undefined,
  rateLimitRemaining: number | null,
): CanvasFailureClass {
  if (httpStatus === 401) return "auth_failed";
  if (httpStatus === 403) {
    if (bodyStatus === "rate limit exceeded" || rateLimitRemaining === 0) return "rate_limited";
    return "auth_failed";
  }
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429) return "rate_limited";
  return "provider_error";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/** `301|302|307|308` -- redirect statuses `fetch`'s `redirect: "manual"` hands back rather than following. */
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

/** Matches CalDAV's own cap (`caldav-client.ts`) -- generous for a real chain, a hard stop for a loop. */
const MAX_REDIRECTS = 5;

/**
 * Every `CanvasClient` call funnels through here, which is what makes this
 * the single chokepoint `validateCanvasUrl` needs to guard: it runs on the
 * INITIAL url and on every redirect target, for the connect-time probe and
 * every later worker sync call alike, not just once at connect time.
 *
 * Redirects are followed manually (`redirect: "manual"`) rather than left to
 * fetch's default so each hop can be re-validated AND so `Authorization` is
 * dropped the moment a redirect leaves the original origin -- mirroring
 * `caldav-client.ts`'s identical `isSameOrigin` gate for the identical
 * credential-leak risk.
 */
async function request<T>(
  url: string,
  token: string,
  fetchFn: FetchLike,
  signal: AbortSignal | undefined,
): Promise<T> {
  let currentUrl = validateCanvasUrl(url);
  const initialOrigin = currentUrl;
  let redirectCount = 0;
  let response: Response;

  for (;;) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (isSameOrigin(initialOrigin, currentUrl)) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    response = await fetchFn(currentUrl.toString(), {
      ...(signal !== undefined ? { signal } : {}),
      headers,
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) break;

    if (redirectCount >= MAX_REDIRECTS) {
      throw new CanvasUrlBlockedError(`Too many redirects at ${currentUrl.toString()}`);
    }
    redirectCount++;
    const location = response.headers.get("location");
    if (!location) {
      throw new CanvasUrlBlockedError(
        `Redirect status ${response.status} carried no Location header`,
      );
    }
    currentUrl = validateCanvasUrl(new URL(location, currentUrl).toString());
  }

  if (!response.ok) {
    let bodyStatus: string | undefined;
    try {
      const parsed = (await response.json()) as CanvasErrorBody;
      bodyStatus = typeof parsed?.status === "string" ? parsed.status : undefined;
    } catch {
      // Non-JSON error body (a gateway failure can return HTML). Nothing to
      // salvage, and nothing worth retaining.
    }
    const rateLimitRemaining = parseRateLimitRemaining(
      response.headers.get(CANVAS_RATE_LIMIT_HEADER),
    );
    throw new CanvasApiError(
      response.status,
      classifyCanvasHttpStatus(response.status, bodyStatus, rateLimitRemaining),
    );
  }

  return (await response.json()) as T;
}

function courseContextCode(courseId: string | number): string {
  return `course_${courseId}`;
}

/**
 * The real Canvas client.
 *
 * `fetchFn` is injectable and defaults to the global, exactly as
 * `createGmailClient` documents: a client that closes over a module-scope
 * fetch instead "consequently has no test file at all. That is a mistake
 * worth not repeating."
 */
export function createCanvasClient(fetchFn: FetchLike = globalThis.fetch): CanvasClient {
  return {
    async getSelf(baseUrl, token, signal) {
      return await request<CanvasSelfResponse>(
        `${normalizeBaseUrl(baseUrl)}${CANVAS_API_VERSION_PATH}/users/self`,
        token,
        fetchFn,
        signal,
      );
    },

    async listActiveCourses(baseUrl, token, signal) {
      const params = new URLSearchParams();
      params.set("enrollment_state", "active");
      params.set("per_page", String(CANVAS_COURSES_PER_PAGE));
      params.append("include[]", "term");
      return await request<CanvasCourseApiShape[]>(
        `${normalizeBaseUrl(baseUrl)}${CANVAS_API_VERSION_PATH}/courses?${params.toString()}`,
        token,
        fetchFn,
        signal,
      );
    },

    async listAssignments(baseUrl, token, courseId, signal) {
      const params = new URLSearchParams();
      params.set("per_page", String(CANVAS_COURSES_PER_PAGE));
      params.append("include[]", "submission");
      return await request<CanvasAssignmentApiShape[]>(
        `${normalizeBaseUrl(baseUrl)}${CANVAS_API_VERSION_PATH}/courses/${encodeURIComponent(
          String(courseId),
        )}/assignments?${params.toString()}`,
        token,
        fetchFn,
        signal,
      );
    },

    async listAnnouncements(baseUrl, token, courseId, signal) {
      const params = new URLSearchParams();
      params.append("context_codes[]", courseContextCode(courseId));
      params.set("per_page", String(CANVAS_COURSES_PER_PAGE));
      return await request<CanvasAnnouncementApiShape[]>(
        `${normalizeBaseUrl(baseUrl)}${CANVAS_API_VERSION_PATH}/announcements?${params.toString()}`,
        token,
        fetchFn,
        signal,
      );
    },

    async listCalendarEvents(baseUrl, token, courseId, signal) {
      const params = new URLSearchParams();
      params.set("type", "event");
      params.append("context_codes[]", courseContextCode(courseId));
      params.set("per_page", String(CANVAS_COURSES_PER_PAGE));
      return await request<CanvasCalendarEventApiShape[]>(
        `${normalizeBaseUrl(baseUrl)}${CANVAS_API_VERSION_PATH}/calendar_events?${params.toString()}`,
        token,
        fetchFn,
        signal,
      );
    },
  };
}
