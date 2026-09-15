import type { HealthSummaryResponse } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { canRequestSync, resolveHealthConnectionState } from "@/components/health/connection-state";
import { api } from "./client";
import { deviceTimezone } from "./today";

// TanStack hooks for the Phase 6 Checkpoint 6.4 Health read surface.
//
// The imports from @/components/health/connection-state are deliberate rather
// than a layering slip: that module is pure and React-free, and it owns the
// frozen precedence that decides whether a sync may be requested at all.
// Re-deriving "is this connection syncable" here would put the same rule in
// two places, and the auto-refresh below is exactly the caller that must not
// disagree with the banner the user is looking at.

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const healthKeys = {
  /** Prefix every health query shares, so one invalidate covers the domain. */
  all: ["health"] as const,
  summary: () => [...healthKeys.all, "summary"] as const,
  series: (metric: string, from: string, to: string) =>
    [...healthKeys.all, "series", metric, from, to] as const,
  // limit is part of the key because "Load more" grows it -- see the sleep
  // hook's comment for why this surface pages by growing limit rather than by
  // advancing offset.
  sleep: (from: string, to: string, limit: number, offset: number) =>
    [...healthKeys.all, "sleep", from, to, limit, offset] as const,
  workouts: (from: string, to: string, limit: number, offset: number) =>
    [...healthKeys.all, "workouts", from, to, limit, offset] as const,
};

// ---------------------------------------------------------------------------
// Module-level sync session state
// ---------------------------------------------------------------------------
//
// Two pieces of state deliberately live at module scope rather than in a hook:
// both must be shared by every mount of every component in the app, and React
// state would reset on remount -- which is the exact failure each one exists to
// prevent. `__resetHealthAutoRefreshForTests` clears both.

/**
 * When a sync was last REQUESTED (accepted by the API), not when one last ran.
 *
 * This exists because `freshness.sync_in_progress` is
 * `EXISTS(a health_sync_runs row with finished_at IS NULL)`, and that row does
 * not exist until the worker actually picks the job off the queue. Between the
 * 202 and the worker starting, the flag is still false. Polling driven only by
 * that flag would therefore refetch once, observe `false`, stop, and never
 * report the result the user just asked for.
 */
let lastSyncRequestedAt: number | null = null;

/** Connection ids the app-open refresh has already fired for this app run. */
const autoRefreshRequested = new Set<string>();

const SYNC_POLL_INTERVAL_MS = 5_000;

/**
 * How long after a request we keep polling even though no run is visible yet.
 *
 * Generous rather than tight: the queue job is `stately` with a 900s expiry, so
 * a busy worker can legitimately take a while to start. 90s covers the enqueue
 * gap without turning a single-user dashboard into a permanent poller -- and if
 * the run does start inside the window, `sync_in_progress` takes over and keeps
 * the poll alive on its own.
 */
const SYNC_SETTLE_MS = 90_000;

/**
 * Poll interval for the summary query.
 *
 * `false` -- not a number -- whenever nothing is happening. A constant poll on
 * a single-user dashboard is waste, and a poll that never stops is worse: it
 * keeps a Tailscale request in flight forever on a device that may be on
 * cellular.
 */
function healthSummaryPollInterval(
  data: HealthSummaryResponse | undefined,
  now: number,
): number | false {
  if (data?.freshness.sync_in_progress === true) return SYNC_POLL_INTERVAL_MS;
  if (lastSyncRequestedAt !== null && now - lastSyncRequestedAt < SYNC_SETTLE_MS) {
    return SYNC_POLL_INTERVAL_MS;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useHealthSummary() {
  return useQuery({
    queryKey: healthKeys.summary(),
    queryFn: () => api.getHealthSummary(deviceTimezone()),
    refetchInterval: (query) => healthSummaryPollInterval(query.state.data, Date.now()),
  });
}

export interface UseHealthMetricSeriesParams {
  metric: string;
  from: string;
  /** INCLUSIVE, matching the route -- see HealthSeriesQuerySchema's note. */
  to: string;
  enabled?: boolean;
}

/**
 * `enabled` is destructured off before the request is built, never forwarded.
 * `HealthSeriesQuerySchema` is `.strict()` and the api-client parses the params
 * object against it before fetching, so an extra key would throw a ZodError
 * rather than being ignored.
 */
export function useHealthMetricSeries(params: UseHealthMetricSeriesParams) {
  const { metric, from, to, enabled = true } = params;
  return useQuery({
    queryKey: healthKeys.series(metric, from, to),
    queryFn: () => api.getHealthMetricSeries({ metric, from, to }),
    enabled: enabled && metric.length > 0,
  });
}

export interface UseHealthSessionsParams {
  from: string;
  /** INCLUSIVE. */
  to: string;
  limit?: number;
  offset?: number;
}

/**
 * The session lists page by GROWING `limit` with `offset` pinned at 0, rather
 * than by advancing `offset` a page at a time.
 *
 * A plain `useQuery` REPLACES its data when the key changes, so advancing the
 * offset would swap the visible page instead of appending to it -- the user
 * would press "Load more" and watch the first thirty rows disappear.
 * Accumulating pages in component state instead reintroduces the bug on every
 * background refetch, when the accumulated copy and the fresh page disagree.
 * `useInfiniteQuery` solves this properly, but there is no precedent for it
 * anywhere in this app, and at single-user scale (a month of sleep is ~30 rows,
 * the schema caps `limit` at 200) refetching one slightly larger list is both
 * cheaper to reason about and always self-consistent.
 *
 * `offset` stays in the signature and the key because the route supports it and
 * a future caller may want a real cursor.
 */
export function useHealthSleepSessions(params: UseHealthSessionsParams) {
  const { from, to, limit = 50, offset = 0 } = params;
  return useQuery({
    queryKey: healthKeys.sleep(from, to, limit, offset),
    queryFn: () => api.getHealthSleepSessions({ from, to, limit, offset }),
  });
}

export function useHealthWorkoutSessions(params: UseHealthSessionsParams) {
  const { from, to, limit = 50, offset = 0 } = params;
  return useQuery({
    queryKey: healthKeys.workouts(from, to, limit, offset),
    queryFn: () => api.getHealthWorkoutSessions({ from, to, limit, offset }),
  });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncHealthNowVariables {
  connectionId: string;
  /** `warm` (the server default) densifies and tombstones; `hot` never does. */
  kind?: "hot" | "warm";
}

/**
 * Request a sync. This never claims the sync SUCCEEDED, or even ran: the route
 * answers `{ queued }` the moment the job is enqueued, and the only durable
 * evidence of what happened is `freshness` on the next summary read. So the
 * mutation records that a request went out (which keeps the poll alive) and
 * invalidates -- it writes nothing optimistic into the cache.
 */
export function useSyncHealthNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: SyncHealthNowVariables) =>
      api.syncHealthConnectionNow(vars.connectionId, vars.kind),
    onSuccess: () => {
      lastSyncRequestedAt = Date.now();
      void queryClient.invalidateQueries({ queryKey: healthKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// App-open bounded refresh
// ---------------------------------------------------------------------------

export interface ShouldAutoRefreshInput {
  summary: HealthSummaryResponse | undefined;
  alreadyRequested: ReadonlySet<string>;
}

/**
 * Pure predicate behind the app-open refresh, exported so the whole decision is
 * testable without a React renderer (this app ships none -- see the hand-rolled
 * harness note in STATUS.md).
 *
 * Every condition here is a guard against a specific bad outcome:
 *
 * - no summary / no connection  -- nothing to sync, and asserting otherwise
 *                                  would be a claim about a connection we have
 *                                  not seen.
 * - `alreadyRequested`          -- at most one per connection per app run.
 * - `canRequestSync`            -- the same frozen precedence the banner shows,
 *                                  so we never fire while the UI says the
 *                                  connection needs reconnecting.
 * - today not yet covered      -- this tops up TODAY, it is not a refresh
 *                                  button and not a staleness remedy (a hot
 *                                  pass cannot clear staleness -- see the
 *                                  predicate). Firing unconditionally would hit
 *                                  the provider on a schedule nobody asked for,
 *                                  on top of the hourly cron that already runs.
 * - `sync_in_progress`          -- redundant with `canRequestSync` today, since
 *                                  the state resolver returns "syncing" first.
 *                                  Stated anyway because the contract here is
 *                                  "stale AND idle", and it must not silently
 *                                  change if that precedence is ever reordered.
 */
export function shouldAutoRefresh(input: ShouldAutoRefreshInput): { connectionId: string } | null {
  const { summary, alreadyRequested } = input;
  if (summary === undefined) return null;

  const { configured, connection, freshness } = summary;
  if (connection === null) return null;
  if (alreadyRequested.has(connection.id)) return null;

  const state = resolveHealthConnectionState({ configured, connection, freshness });
  if (!canRequestSync(state)) return null;

  if (freshness.sync_in_progress) return null;

  // The trigger is "today is not covered yet", NOT `is_stale`, and the
  // difference is load-bearing rather than cosmetic.
  //
  // This hook requests a `hot` window, which is correct and must not change: a
  // hot pass is the one mode ADR-046a/047a forbid from densifying or
  // tombstoning, so it is the only kind safe to fire automatically without the
  // user asking. But `hot` is also, by that same rule, never authoritative --
  // and the worker writes `verified_through_date` only on an authoritative
  // pass. `is_stale` derives purely from `verified_through_date`, so a hot
  // sync can NEVER clear it. Triggering on staleness therefore meant firing a
  // request on every app open, polling for 90 seconds, and leaving the banner
  // exactly as it was: work the user pays for that cannot change what prompted
  // it. Staleness is resolved by the manual button (which resolves to `manual`)
  // or by the hourly cron's warm pass -- both authoritative.
  //
  // What a hot pass CAN do is fill in today's numbers, which is precisely what
  // a user opening the app wants and precisely what the dashboard is showing as
  // "not synced yet". So the condition is now the one this mechanism can
  // actually satisfy.
  if (freshness.verified_through_date !== null && freshness.verified_through_date >= summary.local_date) {
    return null;
  }

  return { connectionId: connection.id };
}

/**
 * `shouldAutoRefresh` against the module-level guard, claiming the connection
 * id BEFORE returning.
 *
 * Claiming first (rather than after the request resolves) is what makes the
 * once-per-run guarantee hold under a re-render that happens while the request
 * is still in flight. A failed request deliberately does NOT release the claim:
 * "at most once per app run" is the contract, and automatically retrying a
 * failing provider call on every render is an unbounded loop.
 *
 * The hook is a one-line wrapper over this, so the path the tests exercise is
 * the path the app runs.
 */
export function claimHealthAutoRefresh(
  summary: HealthSummaryResponse | undefined,
): { connectionId: string } | null {
  const decision = shouldAutoRefresh({ summary, alreadyRequested: autoRefreshRequested });
  if (decision === null) return null;
  autoRefreshRequested.add(decision.connectionId);
  return decision;
}

/** Clears both pieces of module-level sync state. Tests only. */
export function __resetHealthAutoRefreshForTests(): void {
  autoRefreshRequested.clear();
  lastSyncRequestedAt = null;
}

/**
 * Fire one bounded `hot` sync when the app opens onto stale Health data.
 *
 * MOUNTED IN EXACTLY ONE PLACE: `app/health/index.tsx`. Do not call it from a
 * nested component, and do not call it from a second screen. The module-level
 * Set makes a duplicate mount harmless, but "one owner" is the property that
 * makes the behaviour legible -- two callers would mean two places to look when
 * asking why a sync fired.
 *
 * `hot` and never `warm`: hot is the cheap recent-window pass and never writes
 * verified-absence rows or tombstones (ADR-046a/047a). An automatic, unattended
 * refresh has no business doing either. `warm` remains the explicit,
 * user-pressed Sync button.
 */
export function useHealthAutoRefresh(summary: HealthSummaryResponse | undefined): void {
  const { mutate } = useSyncHealthNow();

  useEffect(() => {
    const decision = claimHealthAutoRefresh(summary);
    if (decision === null) return;
    mutate({ connectionId: decision.connectionId, kind: "hot" });
  }, [summary, mutate]);
}
