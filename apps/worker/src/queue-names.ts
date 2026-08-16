// Must match the identical constants in apps/api/src/queue-names.ts -- the
// two processes only share an interface through Postgres/pg-boss, not code
// (same convention as this file's existing HEARTBEAT_QUEUE in index.ts).
export const CAPTURE_PARSE_QUEUE = "capture.parse";
export const OCCURRENCES_EXPAND_WINDOW_QUEUE = "occurrences.expand-window";
export const OCCURRENCES_GENERATE_LAZY_QUEUE = "occurrences.generate-lazy";

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
} as const;
