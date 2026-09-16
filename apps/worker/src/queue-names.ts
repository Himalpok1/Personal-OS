// Must match the identical constants in apps/api/src/queue-names.ts -- the
// two processes only share an interface through Postgres/pg-boss, not code
// (same convention as this file's existing HEARTBEAT_QUEUE in index.ts).
export const CAPTURE_PARSE_QUEUE = "capture.parse";
// Dead-letter target for capture.parse (Checkpoint 8.6A). Same ordering rule
// as PTT_TRANSCRIBE_DEAD_QUEUE: create it BEFORE the primary queue, because
// pg-boss's queue.dead_letter is a foreign key against queue.name.
//
// NOTE FOR DEPLOYMENT: `capture.parse` already exists in production without a
// dead_letter, and createQueue is INSERT ... ON CONFLICT DO NOTHING -- so
// passing `deadLetter` to createQueue is a SILENT NO-OP on an existing queue.
// Both processes therefore also call boss.updateQueue(), which is pg-boss's
// supported UPDATE path for exactly this.
export const CAPTURE_PARSE_DEAD_QUEUE = "capture.parse.dead";
export const OCCURRENCES_EXPAND_WINDOW_QUEUE = "occurrences.expand-window";
// Dead-letter target for occurrences.expand-window (Checkpoint 9.0). WORKER-ONLY,
// like its primary: apps/api never sends to or creates the expand-window queue,
// so there is nothing for the api copy of this file to mirror. Same ordering
// rule as every other *_DEAD_QUEUE (create it BEFORE the primary -- FK), and
// the same deployment note as CAPTURE_PARSE_DEAD_QUEUE: the primary already
// exists in production without a dead_letter, so createQueue's deadLetter
// option is a silent no-op there and boss.updateQueue() is what attaches it.
// See jobs/occurrences-dead-letter.ts.
export const OCCURRENCES_EXPAND_WINDOW_DEAD_QUEUE = "occurrences.expand-window.dead";
export const OCCURRENCES_GENERATE_LAZY_QUEUE = "occurrences.generate-lazy";
// Dead-letter target for occurrences.generate-lazy (Checkpoint 9.0). SHARED:
// apps/api creates and sends to the primary from the occurrence complete/skip
// routes, so both processes must create this dead queue, then the primary
// with `deadLetter`, then updateQueue -- identically, in that order (see
// CAPTURE_PARSE_DEAD_QUEUE above for why all three steps are load-bearing).
export const OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE = "occurrences.generate-lazy.dead";
export const PTT_TRANSCRIBE_QUEUE = "ptt.transcribe";
// Dead-letter target for ptt.transcribe -- must be created via createQueue
// *before* the primary queue (pg-boss's dead_letter column is a foreign key
// against queue.name), then given its own work() handler for the
// terminal-failure cleanup a normal retry-exhausted job routes into.
export const PTT_TRANSCRIBE_DEAD_QUEUE = "ptt.transcribe.dead";
export const NOTIFICATIONS_DISPATCH_QUEUE = "notifications.dispatch";
export const NOTIFICATIONS_DISPATCH_DEAD_QUEUE = "notifications.dispatch.dead";

// Phase 4 Checkpoint 4.5 Stage B (Google Calendar sync) -- must match
// apps/api/src/queue-names.ts exactly. All three are also created by
// apps/api (refresh-token and sync-calendar are enqueued by API routes;
// push-event will be enqueued wherever local event mutation happens --
// currently only apps/worker enqueues it, from calendar-sync-calendar.ts's
// own upsert path is out of scope here per the B3 brief, but the queue
// itself must still exist identically in both processes).
export const CALENDAR_REFRESH_TOKEN_QUEUE = "calendar.google.refresh-token";
export const CALENDAR_REFRESH_TOKEN_DEAD_QUEUE = "calendar.google.refresh-token.dead";
export const CALENDAR_SYNC_CALENDAR_QUEUE = "calendar.google.sync-calendar";
export const CALENDAR_SYNC_CALENDAR_DEAD_QUEUE = "calendar.google.sync-calendar.dead";
export const CALENDAR_PUSH_EVENT_QUEUE = "calendar.google.push-event";
export const CALENDAR_PUSH_EVENT_DEAD_QUEUE = "calendar.google.push-event.dead";

// pg-boss's create_queue is INSERT ... ON CONFLICT DO NOTHING: whichever
// process calls createQueue() first wins, and later calls with different
// options are silently ignored. Since either apps/api or apps/worker may
// start first, both must pass identical retry options for a given queue --
// must match apps/api/src/queue-names.ts's QUEUE_RETRY_OPTIONS exactly for
// the two queues apps/api also creates (capture.parse and
// occurrences.generate-lazy). occurrences.expand-window is worker-only.

// Phase 6 Checkpoint 6.3 (Google Health sync). ONE shared queue, no dead-letter.
//
// WHY THERE IS NO DEAD-LETTER QUEUE AND NO pg-boss RETRY:
//
// `policy: "stately"` is what bounds queue depth (one job per state per
// singletonKey, enforced by pg-boss's `job_i3` unique index). But pg-boss
// documents, at dist/manager.js:1293, that under exactly this policy "the
// retry insert can be dropped by ON CONFLICT when the queue policy (e.g.
// stately, singleton, key_strict_fifo) already has a non-terminal job" -- in
// which case the job is re-inserted as `failed` and pushed straight to the
// dead-letter queue, skipping its remaining retryLimit. With an hourly cron
// and a persistent fault, a *first* transient failure could therefore reach a
// handler meant for terminal cleanup.
//
// `retryLimit: 0` removes the interaction entirely: no `retry` rows exist, so
// no retry can be dropped, nothing is spuriously dead-lettered, and the depth
// bound becomes exactly one `created` + one `active` per connection. Health
// sync is idempotent and cron-driven -- the hourly tick IS the retry, and a
// better one, because it re-derives the window from current state instead of
// replaying a stale job. Provider-level retries live in the limiter
// (@personal-os/health-providers sync/limiter.ts), bounded and full-jittered.
//
// `expireInSeconds` must stay strictly greater than the limiter's
// passBudgetMs (600s), or pg-boss's 15-minute default would un-`active` a job
// whose handler is still running and still holding its connection advisory
// lock.
export const HEALTH_SYNC_CONNECTION_QUEUE = "health.google.sync-connection";

// Phase 7 Checkpoint 7.3 (Gmail sync). ONE shared queue, no dead-letter.
//
// The Health precedent is followed EXACTLY, and for the same documented
// reason rather than by analogy: pg-boss's own dist/manager.js:1293 states
// that under `policy: "stately"` "the retry insert can be dropped by ON
// CONFLICT when the queue policy ... already has a non-terminal job", after
// which the job is re-inserted as `failed` and pushed straight to the
// dead-letter queue, SKIPPING its remaining retryLimit. With a cron and a
// persistent fault, a merely-transient first failure could therefore land in a
// handler meant for terminal cleanup.
//
// `retryLimit: 0` removes the interaction outright: no `retry` rows exist, so
// none can be dropped, nothing is spuriously dead-lettered, and queue depth is
// provably one `created` + one `active` per connection however fast requests
// arrive. Mail sync is idempotent and cron-driven, so the tick IS the retry --
// and a better one, because it re-derives the cursor from current state rather
// than replaying a stale payload. Provider-level retries live in the limiter
// (@personal-os/mail-providers limiter.ts), bounded, and -- unlike Health's --
// honouring Retry-After.
//
// `expireInSeconds` must stay strictly greater than the limiter's passBudgetMs
// (300s), or pg-boss would un-`active` a job whose handler is still running and
// still holding its per-connection advisory lock, after which every subsequent
// pass would fail to acquire and skip forever.
export const MAIL_SYNC_CONNECTION_QUEUE = "mail.gmail.sync-connection";

// Checkpoint 10.1 (Canvas LMS sync, ADR-068). ONE connection-level queue, no
// dead-letter -- the identical Health/Mail precedent, for the identical
// documented reason: under `policy: "stately"` pg-boss can drop a retry
// insert on conflict and re-insert the job as failed, straight past its
// remaining retries (pg-boss/dist/manager.js:1293). `retryLimit: 0` removes
// the interaction outright. Canvas sync is idempotent (hash-gated upsert,
// see apps/worker/src/canvas/persist.ts) and cron-driven, so the hourly tick
// IS the retry -- and a better one, because it re-derives every course from
// current provider state rather than replaying a stale job. There is no
// separate rate limiter package for Canvas (unlike mail/health): ADR-068's
// live discovery probe observed `X-Rate-Limit-Remaining` hold steady at 700
// across ~15 requests, and a full per-course sweep at 16 courses is well
// inside that headroom run serially with no artificial pacing.
//
// `expireInSeconds` (900s, matching mail) is generous relative to a serial
// sweep of a few dozen requests across a realistic course load, so pg-boss
// can never un-`active` a job whose handler is still genuinely running.
export const CANVAS_SYNC_CONNECTION_QUEUE = "canvas.sync-connection";

// Phase 7 Checkpoint 7.4 (mail digest). ONE queue, no dead-letter.
//
// Same shape and same reasoning as the mail sync queue immediately above:
// `retryLimit: 0` because under `policy: "stately"` pg-boss can drop a retry
// insert on conflict and re-insert the job as failed, straight past its
// remaining retries. The daily cron tick IS the retry, and a better one -- it
// re-collects from current state rather than replaying a stale payload.
//
// `singletonKey` is the digest key rather than a connection id, because the
// digest is GLOBAL across every active mailbox (ADR-053): there is exactly one
// digest per (date, timezone), so two overlapping generations would race to
// upsert the same row and pay two provider calls for one answer.
//
// `expireInSeconds` comfortably exceeds the generation budget (45s whole-chain,
// 30s per attempt), so pg-boss can never un-`active` a job mid-provider-call.
export const MAIL_DIGEST_GENERATE_QUEUE = "mail.digest.generate";

// Phase 7 Checkpoint 7.5 (service monitoring). ONE queue, no dead-letter.
//
// Same shape and same documented reason as the two mail queues above: under
// `policy: "stately"` pg-boss can drop a retry insert on conflict and re-insert
// the job as failed, straight past its remaining retries
// (pg-boss/dist/manager.js:1293). The cron tick IS the retry, and a better one
// -- it re-reads targets and check history from current state rather than
// replaying a stale payload.
//
// The singletonKey is a FIXED string rather than a target id, because a pass is
// a sweep over every http target rather than a per-target job. Two overlapping
// sweeps would probe everything twice and write duplicate checks, corrupting the
// very history the failure thresholds are derived from.
//
// `expireInSeconds` exceeds the worst realistic sweep: a handful of targets at a
// 10s timeout each, probed sequentially.
export const MONITOR_RUN_QUEUE = "monitor.run";

export const QUEUE_RETRY_OPTIONS = {
  [MONITOR_RUN_QUEUE]: {
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 300,
  },
  [MAIL_DIGEST_GENERATE_QUEUE]: {
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 300,
  },
  // Per-connection serialization AND duplicate suppression, exactly as
  // HEALTH_SYNC_CONNECTION_QUEUE. singletonKey is `${connectionId}`, so every
  // trigger -- cron tick, a future manual "sync now" -- collapses onto one slot
  // per connection. "stately", not "singleton": singleton allows 1 active but
  // UNLIMITED queued, which is serialization without duplicate suppression.
  [MAIL_SYNC_CONNECTION_QUEUE]: {
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 900,
  },
  // Per-connection serialization AND duplicate suppression, exactly as the
  // mail/health entries above. singletonKey is `${connectionId}`, so the
  // hourly cron tick (and any future manual "sync now") collapses onto one
  // slot per connection.
  [CANVAS_SYNC_CONNECTION_QUEUE]: {
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 900,
  },
  // Per-connection serialization AND duplicate suppression. singletonKey is
  // `${connectionId}`, so every trigger -- hourly cron, app-open, manual
  // "sync now" -- collapses onto one slot per connection, and at most one
  // job per connection is ever active. See the block above for retryLimit 0.
  [HEALTH_SYNC_CONNECTION_QUEUE]: {
    // "stately", NOT "singleton": singleton allows 1 active but UNLIMITED
    // queued, which is serialization without duplicate suppression. stately
    // allows one job per state, so with retryLimit 0 (no `retry` rows) the
    // depth is provably one `created` + one `active` per connection, forever,
    // regardless of how fast requests arrive.
    policy: "stately",
    retryLimit: 0,
    expireInSeconds: 900,
  },
  [CAPTURE_PARSE_QUEUE]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [OCCURRENCES_EXPAND_WINDOW_QUEUE]: { retryLimit: 3, retryDelay: 60 },
  [OCCURRENCES_GENERATE_LAZY_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
  // Bounded -- a persistently-failing STT call shouldn't retry forever and
  // burn provider quota.
  [PTT_TRANSCRIBE_QUEUE]: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
  [NOTIFICATIONS_DISPATCH_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
  [CALENDAR_REFRESH_TOKEN_QUEUE]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [CALENDAR_SYNC_CALENDAR_QUEUE]: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    policy: "singleton",
  },
  [CALENDAR_PUSH_EVENT_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
} as const;
