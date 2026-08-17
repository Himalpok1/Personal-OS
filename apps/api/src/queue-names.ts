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
} as const;
