// Must match the identical constants in apps/worker/src/queue-names.ts --
// the two processes only share an interface through Postgres/pg-boss, not
// code, so these are kept as local literals per queue (same convention as
// apps/worker's existing HEARTBEAT_QUEUE) rather than a shared package.
export const CAPTURE_PARSE_QUEUE = "capture.parse";
export const OCCURRENCES_GENERATE_LAZY_QUEUE = "occurrences.generate-lazy";
export const PTT_TRANSCRIBE_QUEUE = "ptt.transcribe";
export const PTT_TRANSCRIBE_DEAD_QUEUE = "ptt.transcribe.dead";
export const NOTIFICATIONS_DISPATCH_QUEUE = "notifications.dispatch";
export const NOTIFICATIONS_DISPATCH_DEAD_QUEUE = "notifications.dispatch.dead";

// Phase 4 Checkpoint 4.5 Stage B (Google Calendar sync).
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
// must match apps/worker/src/queue-names.ts's QUEUE_RETRY_OPTIONS exactly.
export const QUEUE_RETRY_OPTIONS = {
  [CAPTURE_PARSE_QUEUE]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  [OCCURRENCES_GENERATE_LAZY_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
  [PTT_TRANSCRIBE_QUEUE]: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
  [NOTIFICATIONS_DISPATCH_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
  [CALENDAR_REFRESH_TOKEN_QUEUE]: { retryLimit: 5, retryDelay: 30, retryBackoff: true },
  // "singleton" policy + a per-send singletonKey of `${connectionId}:${googleCalendarId}`
  // is this queue's per-calendar serialization mechanism (pg-boss@12.27.0's
  // documented QueuePolicy: "only allows 1 job to be active, unlimited
  // queued" per key) -- a sync-now request while a sync is already in
  // flight for that calendar becomes a harmless queued duplicate rather
  // than a concurrent run, with no separate DB lock needed.
  [CALENDAR_SYNC_CALENDAR_QUEUE]: {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    policy: "singleton",
  },
  [CALENDAR_PUSH_EVENT_QUEUE]: { retryLimit: 5, retryDelay: 15, retryBackoff: true },
} as const;
