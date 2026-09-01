import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

// Service monitoring contracts (ADR-055).
//
// The vocabularies split exactly as ADR-050 requires and as the mail lane
// already does: a CLOSED enum where the set is genuinely closed and this project
// controls it, a SHAPE-CONSTRAINED TOKEN where the set legitimately grows.
//
//   `kind`, `status`, incident status  -> closed enums, CHECK-constrained.
//   `failure_class`                    -> a token, no CHECK, sanitized on the
//                                         way out, because new failure modes are
//                                         discovered rather than designed.

/**
 * How a target is observed.
 *
 * `worker_heartbeat` exists as a distinct kind rather than as an HTTP probe of
 * `/health` because the two answer different questions and, decisively, run in
 * different processes: a worker cannot alert on its own death, so the heartbeat
 * check is evaluated by the API (ADR-055).
 */
export const MonitorTargetKindSchema = z.enum(["http", "worker_heartbeat"]);
export type MonitorTargetKind = z.infer<typeof MonitorTargetKindSchema>;

/**
 * What one probe execution observed.
 *
 * `skipped` is a real outcome, not an absence: a check suppressed by a
 * maintenance window records that we deliberately did not look. Threshold
 * evaluation excludes it, and the uptime read model renders it as
 * `not_checked` rather than as downtime.
 */
export const MonitorCheckStatusSchema = z.enum(["up", "down", "skipped"]);
export type MonitorCheckStatus = z.infer<typeof MonitorCheckStatusSchema>;

export const MonitorIncidentStatusSchema = z.enum(["open", "acknowledged", "resolved"]);
export type MonitorIncidentStatus = z.infer<typeof MonitorIncidentStatusSchema>;

/**
 * The three-state uptime model ADR-055 requires.
 *
 * A window in which the monitor was NOT RUNNING must never render as `0%`. That
 * is the same failure the health dashboard's `HealthMetricPoint` was designed
 * against -- a missing measurement presented as a real zero -- and it is
 * prevented the same way: a structural refine that makes the wrong shape
 * unrepresentable rather than merely discouraged.
 */
export const MonitorUptimeStateSchema = z.enum(["up", "down", "not_checked"]);
export type MonitorUptimeState = z.infer<typeof MonitorUptimeStateSchema>;

/**
 * One point on an uptime series.
 *
 * THE REFINE IS THE POINT. `ratio` is non-null EXACTLY when `state` is not
 * `not_checked`, so "we did not look" cannot be expressed as a number, and a
 * gap in monitoring cannot be silently rendered as an outage.
 */
export const MonitorUptimePointSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    state: MonitorUptimeStateSchema,
    ratio: z.number().min(0).max(1).nullable(),
  })
  .refine((p) => (p.state === "not_checked") === (p.ratio === null), {
    message: "ratio must be null exactly when state is not_checked",
    path: ["ratio"],
  });
export type MonitorUptimePoint = z.infer<typeof MonitorUptimePointSchema>;

/**
 * The shape every `failure_class` must have: a lowercase machine token with at
 * most one `:`-separated qualifier (`http_status:503`, `tls_expiring`).
 *
 * Identical in spirit to `MailSyncFailureClassSchema`, and load-bearing for the
 * same reason: prose cannot satisfy it -- it has spaces, punctuation and capitals
 * -- so a writer reaching for `err.message` fails HERE rather than in a durable
 * column, a log line, or `pgboss.job.output`. A probe error can carry the URL it
 * failed against, and a target URL may legitimately contain a token.
 */
const MONITOR_FAILURE_CLASS = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;

export const MonitorFailureClassSchema = z.string().regex(MONITOR_FAILURE_CLASS);

/**
 * Narrows a stored failure class to a token, or `probe_error` when it is not
 * token-shaped.
 *
 * Applied at every projection site, so a row written by an older or buggier
 * build is neutralised with no data migration -- the boundary-guard pattern
 * `sanitizeMailSyncErrorCode` and `sanitizeCalendarSyncErrorCode` established.
 */
export function sanitizeMonitorFailureClass(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return MONITOR_FAILURE_CLASS.test(raw) ? raw : "probe_error";
}

/**
 * A monitor target on the wire.
 *
 * `url` IS PROJECTED, and that is a deliberate decision rather than an
 * oversight. Targets are server-configured by an operator who already knows the
 * URLs, and a monitoring view that cannot say WHICH endpoint is down is not
 * worth having. What is never projected is a probe error's text -- see
 * `failure_class` -- because that is the channel a URL with a token in it would
 * escape through unintentionally.
 */
export const MonitorTargetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: MonitorTargetKindSchema,
  url: z.string().url().nullable(),
  expected_status: z.number().int().min(100).max(599),
  expect_healthy_payload: z.boolean(),
  timeout_ms: z.number().int().positive(),
  interval_seconds: z.number().int().positive(),
  failure_threshold: z.number().int().positive(),
  recovery_threshold: z.number().int().positive(),
  tls_warn_days: z.number().int().positive().nullable(),
  heartbeat_max_age_seconds: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  maintenance_start: z.string().nullable(),
  maintenance_end: z.string().nullable(),
  maintenance_timezone: z
    .string()
    .refine(isValidTimezone, { message: "unknown IANA timezone" })
    .nullable(),
  muted_until: z.string().datetime({ offset: true }).nullable(),
});
export type MonitorTarget = z.infer<typeof MonitorTargetSchema>;

/**
 * A target as an operator supplies it.
 *
 * `.strict()`, so a typo is a validation failure rather than a silently-ignored
 * field -- the convention every write contract in this repository follows. The
 * cross-field rules a single field cannot express (an `http` target needs a URL;
 * a `worker_heartbeat` target must not have one) are refines, so an
 * unmonitorable target cannot be created at all.
 */
export const MonitorTargetCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    kind: MonitorTargetKindSchema,
    url: z.string().url().nullable().optional(),
    expected_status: z.number().int().min(100).max(599).optional(),
    expect_healthy_payload: z.boolean().optional(),
    timeout_ms: z.number().int().positive().max(120_000).optional(),
    interval_seconds: z.number().int().positive().optional(),
    failure_threshold: z.number().int().positive().max(100).optional(),
    recovery_threshold: z.number().int().positive().max(100).optional(),
    tls_warn_days: z.number().int().positive().max(365).nullable().optional(),
    heartbeat_max_age_seconds: z.number().int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    maintenance_start: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/)
      .nullable()
      .optional(),
    maintenance_end: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/)
      .nullable()
      .optional(),
    maintenance_timezone: z
      .string()
      .refine(isValidTimezone, { message: "unknown IANA timezone" })
      .nullable()
      .optional(),
    muted_until: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine((t) => t.kind !== "http" || (t.url !== null && t.url !== undefined), {
    message: "an http target requires a url",
    path: ["url"],
  })
  .refine((t) => t.kind !== "worker_heartbeat" || t.url === null || t.url === undefined, {
    message: "a worker_heartbeat target observes a table, not a url",
    path: ["url"],
  })
  .refine(
    (t) =>
      t.kind !== "http" ||
      t.tls_warn_days === null ||
      t.tls_warn_days === undefined ||
      (t.url ?? "").startsWith("https://"),
    {
      // A TLS warning on a plaintext URL would produce a probe that can never
      // succeed and an alert nobody can act on.
      message: "tls_warn_days requires an https url",
      path: ["tls_warn_days"],
    },
  )
  .refine(
    (t) =>
      [t.maintenance_start, t.maintenance_end, t.maintenance_timezone].filter(
        (v) => v !== null && v !== undefined,
      ).length %
        3 ===
      0,
    {
      // All-or-nothing, matching the database CHECK. A window with a start and
      // no timezone is not a window; it is a bug that would evaluate in
      // whatever zone the server happens to run in.
      message: "maintenance_start, maintenance_end and maintenance_timezone are all-or-nothing",
      path: ["maintenance_timezone"],
    },
  );
export type MonitorTargetCreate = z.infer<typeof MonitorTargetCreateSchema>;

/** One recorded probe execution, on the wire. */
export const MonitorCheckSchema = z.object({
  id: z.string().uuid(),
  target_id: z.string().uuid(),
  status: MonitorCheckStatusSchema,
  http_status: z.number().int().nullable(),
  latency_ms: z.number().int().min(0).nullable(),
  // A CODE, never a message. See MonitorFailureClassSchema.
  failure_class: MonitorFailureClassSchema.nullable(),
  tls_expires_at: z.string().datetime({ offset: true }).nullable(),
  tls_days_remaining: z.number().int().nullable(),
  heartbeat_age_seconds: z.number().int().min(0).nullable(),
  checked_at: z.string().datetime({ offset: true }),
});
export type MonitorCheck = z.infer<typeof MonitorCheckSchema>;

export const MonitorIncidentSchema = z.object({
  id: z.string().uuid(),
  target_id: z.string().uuid(),
  status: MonitorIncidentStatusSchema,
  failure_class: MonitorFailureClassSchema.nullable(),
  opened_at: z.string().datetime({ offset: true }),
  acknowledged_at: z.string().datetime({ offset: true }).nullable(),
  resolved_at: z.string().datetime({ offset: true }).nullable(),
  last_failure_at: z.string().datetime({ offset: true }).nullable(),
});
export type MonitorIncident = z.infer<typeof MonitorIncidentSchema>;
