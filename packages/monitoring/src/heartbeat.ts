import { workerHeartbeat, type Db } from "@personal-os/db";

// The worker-heartbeat observation.
//
// ===========================================================================
// THIS IS THE UNBUILT HALF OF ARCHITECTURE.md's OWN MANDATE.
// ===========================================================================
//
// docs/ARCHITECTURE.md has said since Phase 0 that "Worker crashes must be loud.
// A silently dead worker means captures sit unparsed and reminders never
// dispatch, and you won't notice for days. Add a heartbeat row it updates each
// cycle and alert on staleness."
//
// The heartbeat row shipped in Phase 0 and `GET /health` has reported
// `worker.stale` ever since -- but NOTHING EVER ALERTED ON IT. Reporting a fact
// on an endpoint nobody polls is not alerting; it is a fact waiting to be
// noticed.
//
// ADR-055 assigns the alerting half to the API PROCESS, and the reason is not a
// preference: a worker-hosted monitor cannot alert on its own death. A cron job
// that checks whether the worker is alive does not run when the worker is dead.
//
// The observation itself is pure and lives here so both the API's watchdog and
// the tests use the same arithmetic; the SCHEDULING is the API's.

export interface HeartbeatObservation {
  /** Null when the worker has never beaten -- a first boot, or a wiped table. */
  lastBeatAt: Date | null;
  /** Null when there is no beat to measure from. */
  ageSeconds: number | null;
  stale: boolean;
}

/**
 * Reads the heartbeat row and decides whether it is stale.
 *
 * A MISSING ROW COUNTS AS STALE, deliberately. The alternative -- treating "no
 * heartbeat has ever been recorded" as healthy -- is precisely the shape of
 * failure that hides a worker which has never successfully started. The very
 * first deploy would then report green while nothing was processing, which is
 * the worst possible moment to be reassuring.
 *
 * The cost is that a freshly-migrated database reports one stale check before
 * the worker's first beat lands. That is the correct trade: a brief, accurate
 * "not running yet" beats a permanent, wrong "fine".
 */
export async function observeWorkerHeartbeat(
  db: Db,
  maxAgeSeconds: number,
  now: Date = new Date(),
): Promise<HeartbeatObservation> {
  const [row] = await db.select().from(workerHeartbeat).limit(1);
  const lastBeatAt = row?.lastBeatAt ?? null;

  if (lastBeatAt === null) return { lastBeatAt: null, ageSeconds: null, stale: true };

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - lastBeatAt.getTime()) / 1000));
  return { lastBeatAt, ageSeconds, stale: ageSeconds > maxAgeSeconds };
}

/**
 * The failure class a stale heartbeat produces.
 *
 * Two distinct tokens rather than one, because they mean genuinely different
 * things to whoever reads them: `worker_never_started` is a deployment problem,
 * `worker_heartbeat_stale` is a running worker that died or hung. Collapsing
 * them would send an operator looking in the wrong place first.
 */
export function heartbeatFailureClass(observation: HeartbeatObservation): string | null {
  if (!observation.stale) return null;
  return observation.lastBeatAt === null ? "worker_never_started" : "worker_heartbeat_stale";
}
