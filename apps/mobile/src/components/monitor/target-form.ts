import { ApiClientError } from "@personal-os/api-client";
import type { MonitorTargetCreate, MonitorTargetKind } from "@personal-os/schema";

// Pure, React-free helpers shared by the monitor create (`monitor/new.tsx`)
// and edit (`monitor/[id].tsx`) screens (Checkpoint 8.6D).
//
// Kept in one file rather than duplicated across the two screens for the same
// reason `target-state.ts` is its own module: two copies of "which fields
// apply to which kind" or "what a rejected save means" could silently drift,
// and this project has already paid for that kind of drift once (mail and
// health each got their own sync-error-copy helper rather than inlining
// `err.message`, per Settings' `describeActionFailure` precedent).

/** Strips everything but digits, e.g. for a numeric `TextInput`'s `onChangeText`. */
export function onlyDigits(text: string): string {
  return text.replace(/[^0-9]/g, "");
}

/**
 * Parses a numeric field left empty as "not set" (`undefined`, so the caller
 * can omit the key entirely and let the server apply its own default) rather
 * than as zero -- and rejects non-positive input the same way, since every
 * field this is used for (`timeout_ms`, `interval_seconds`, thresholds,
 * `tls_warn_days`, `heartbeat_max_age_seconds`) is a positive quantity.
 * The server still re-validates -- this only avoids sending an obviously
 * broken number from a blank or stray-character field.
 */
export function parseOptionalPositiveInt(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Whether `url` is `https://`, case-insensitively and ignoring surrounding
 * whitespace -- the same condition `tls_warn_days` is only meaningful under
 * (`MonitorTargetCreateSchema`'s refine on the server). Used here purely to
 * decide whether to SHOW the TLS field at all; the server is the actual
 * authority on the rule.
 */
export function isHttpsUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("https://");
}

/**
 * The subset of `MonitorTargetCreate`/`MonitorTargetUpdate` this form's
 * numeric and kind-dependent fields produce. Structurally identical between
 * the two contracts (same field names, same optional/nullable shape), so one
 * return type spreads cleanly into either -- the create screen adds
 * `name`/`kind`, the edit screen adds `name` alone (`kind` is read-only after
 * creation in this app's editor; see `monitor/[id].tsx`).
 */
export type MonitorTargetNumericFields = Pick<
  MonitorTargetCreate,
  | "url"
  | "expected_status"
  | "expect_healthy_payload"
  | "timeout_ms"
  | "interval_seconds"
  | "failure_threshold"
  | "recovery_threshold"
  | "tls_warn_days"
  | "heartbeat_max_age_seconds"
>;

export interface MonitorTargetFormFields {
  kind: MonitorTargetKind;
  url: string;
  expectedStatus: string;
  expectHealthyPayload: boolean;
  timeoutMs: string;
  intervalSeconds: string;
  failureThreshold: string;
  recoveryThreshold: string;
  tlsWarnDays: string;
  heartbeatMaxAgeSeconds: string;
}

/**
 * Builds the kind-dependent and numeric fields of a monitor target payload
 * from this form's string-valued state.
 *
 * `http`-only fields (`url`, `expected_status`, `expect_healthy_payload`,
 * and -- further gated on the url actually being `https://` -- `tls_warn_days`)
 * are included only when `kind === "http"`; `heartbeat_max_age_seconds` only
 * when `kind === "worker_heartbeat"`. This is what keeps an impossible
 * combination (a `worker_heartbeat` target carrying a `url`, or an `http`
 * target carrying `heartbeat_max_age_seconds`) from ever being assembled on
 * the client, rather than merely being rejected by the server after the fact.
 *
 * A blank or non-positive numeric field is OMITTED, not sent as `0` or
 * `NaN` -- see `parseOptionalPositiveInt`. That lets the server's own default
 * apply on create, and leaves the existing value untouched on an edit (the
 * server merges a PATCH onto the current row; see `updateMonitorTarget` in
 * `packages/monitoring/src/targets.ts`).
 */
export function monitorTargetFormFieldsToPayload(
  fields: MonitorTargetFormFields,
): MonitorTargetNumericFields {
  const payload: MonitorTargetNumericFields = {};

  if (fields.kind === "http") {
    payload.url = fields.url.trim();
    payload.expect_healthy_payload = fields.expectHealthyPayload;
    const expectedStatus = parseOptionalPositiveInt(fields.expectedStatus);
    if (expectedStatus !== undefined) payload.expected_status = expectedStatus;
    if (isHttpsUrl(fields.url)) {
      const tlsWarnDays = parseOptionalPositiveInt(fields.tlsWarnDays);
      if (tlsWarnDays !== undefined) payload.tls_warn_days = tlsWarnDays;
    }
  } else {
    const heartbeatMaxAgeSeconds = parseOptionalPositiveInt(fields.heartbeatMaxAgeSeconds);
    if (heartbeatMaxAgeSeconds !== undefined) {
      payload.heartbeat_max_age_seconds = heartbeatMaxAgeSeconds;
    }
  }

  const timeoutMs = parseOptionalPositiveInt(fields.timeoutMs);
  if (timeoutMs !== undefined) payload.timeout_ms = timeoutMs;
  const intervalSeconds = parseOptionalPositiveInt(fields.intervalSeconds);
  if (intervalSeconds !== undefined) payload.interval_seconds = intervalSeconds;
  const failureThreshold = parseOptionalPositiveInt(fields.failureThreshold);
  if (failureThreshold !== undefined) payload.failure_threshold = failureThreshold;
  const recoveryThreshold = parseOptionalPositiveInt(fields.recoveryThreshold);
  if (recoveryThreshold !== undefined) payload.recovery_threshold = recoveryThreshold;

  return payload;
}

/**
 * Fixed copy for a failed create/update, mirroring Settings'
 * `describeActionFailure` -- an `ApiClientError`'s `.code`/`.body` is a
 * developer string, never words meant for a screen, so every call site
 * routes through here instead of reading `err.message` directly.
 *
 * `target_has_active_incident` and `name_already_exists` get their own
 * sentences because they are the two failures a user can actually resolve by
 * doing something different (pick another name; leave the url/kind alone
 * while an incident is open) -- a generic "something went wrong" would send
 * them looking for a bug that isn't there.
 */
export function describeMonitorTargetMutationFailure(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "name_already_exists":
        return "A monitor with that name already exists.";
      case "target_has_active_incident":
        return "Can't change the target/type while an incident is open on it.";
      case "validation_failed":
        return "That configuration wasn't valid.";
      case "not_found":
        return "This monitor target couldn't be found.";
      default:
        return "Couldn't save that monitor target.";
    }
  }
  return "Couldn't save that monitor target.";
}
