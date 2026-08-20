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
export const QUEUE_RETRY_OPTIONS = {
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
