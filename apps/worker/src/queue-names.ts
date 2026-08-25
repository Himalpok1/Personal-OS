// Must match the identical constants in apps/api/src/queue-names.ts -- the
// two processes only share an interface through Postgres/pg-boss, not code
// (same convention as this file's existing HEARTBEAT_QUEUE in index.ts).
export const CAPTURE_PARSE_QUEUE = "capture.parse";
export const OCCURRENCES_EXPAND_WINDOW_QUEUE = "occurrences.expand-window";
export const OCCURRENCES_GENERATE_LAZY_QUEUE = "occurrences.generate-lazy";
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

export const QUEUE_RETRY_OPTIONS = {
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
