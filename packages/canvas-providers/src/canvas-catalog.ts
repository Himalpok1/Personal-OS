// Canvas LMS capability metadata, in code rather than in columns (ADR-068).
//
// Mirrors gmail-catalog.ts's reasoning: this is provider capability metadata,
// not per-connection state. `canvas_connections` holds only what varies per
// institution/owner (base URL, encrypted token); the API version path and
// paging size are facts about the Canvas REST API itself, not about any one
// account.

/**
 * Every Canvas REST call in this package targets this API version, appended
 * directly after the connection's own base URL (e.g.
 * `https://uta.instructure.com` + `/api/v1` + `/courses`).
 */
export const CANVAS_API_VERSION_PATH = "/api/v1";

/**
 * `per_page` sent on every list endpoint this package calls -- courses,
 * assignments, announcements and calendar events. Canvas's documented
 * default is 10; ADR-068's live probe used 100 and it comfortably covered 16
 * active courses (and each course's assignments/announcements/calendar
 * events) in a single page. Named after its first use, courses, because that
 * is the literal constant this checkpoint's brief calls for; reused as-is for
 * the other three list endpoints rather than declaring three near-identical
 * siblings for the same value -- this package makes exactly one paging
 * decision, not four.
 */
export const CANVAS_COURSES_PER_PAGE = 100;

/**
 * Canvas's own rate-limit header, present on every response. ADR-068's live
 * probe observed it hold steady at 700 across roughly 15 requests. Named so a
 * caller reads the header by this constant rather than spelling the string
 * itself -- the same reasoning `GMAIL_METADATA_HEADERS` exists for in
 * mail-providers. Also doubles, in `canvas-client.ts`'s `request()`, as a
 * corroborating signal that a 403 is rate limiting rather than a bad token:
 * `X-Rate-Limit-Remaining: 0` alongside a 403 means throttled, even absent
 * the documented `status: "rate limit exceeded"` body token.
 */
export const CANVAS_RATE_LIMIT_HEADER = "X-Rate-Limit-Remaining";
