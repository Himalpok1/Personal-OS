import type { FastifyInstance } from "fastify";
import { runHeartbeatWatchdog } from "../monitor/heartbeat-watchdog.js";

// Scheduling for the worker-heartbeat watchdog.
//
// ===========================================================================
// AN INTERVAL IN THE HTTP PROCESS, WHICH IS THE HONEST ANSWER
// ===========================================================================
//
// The API has no cron and no queue worker -- it only ever enqueues. So the two
// candidates for scheduling this were an interval, or piggybacking on inbound
// requests.
//
// Piggybacking is worse in exactly the case that matters: a single-user system
// behind Tailscale gets no traffic overnight, which is when a worker is most
// likely to die unnoticed and least likely to be noticed by a person. A monitor
// that only runs when someone is already looking is not a monitor.
//
// The cost of an interval is honest and small: it runs in the request process,
// so a slow evaluation competes with request handling. That is bounded by the
// work itself -- two indexed queries and at most one insert -- and it is why the
// evaluation returns rather than throws, and why errors are swallowed below.
//
// ---------------------------------------------------------------------------
// DISABLED BY DEFAULT IN TESTS, ON IN PRODUCTION.
//
// The default is ON, so a deployment gets monitoring without opting in -- a
// monitoring feature that is off unless someone remembers is a footgun. Tests
// disable it explicitly through `buildTestApp`, because a timer firing against a
// shared test database during someone else's suite is exactly the
// cross-contamination that produced Checkpoint 6.3's shifting, meaningless
// failures.

export interface HeartbeatWatchdogOptions {
  enabled?: boolean;
  intervalMs?: number;
}

/**
 * One minute, matching the worker's own heartbeat cron.
 *
 * Checking faster than the worker beats would only produce checks that observe
 * the same beat twice; the target's `interval_seconds` is what actually paces
 * the recorded checks, and this interval is just the upper bound on how soon one
 * can happen.
 */
const DEFAULT_INTERVAL_MS = 60_000;

declare module "fastify" {
  interface FastifyInstance {
    /** Exposed so a test can run one evaluation without waiting for a timer. */
    runHeartbeatWatchdogOnce: () => Promise<void>;
  }
}

export function registerHeartbeatWatchdog(
  app: FastifyInstance,
  options: HeartbeatWatchdogOptions = {},
): void {
  const runOnce = async (): Promise<void> => {
    try {
      await runHeartbeatWatchdog({ db: app.db, boss: app.bossReady ? app.boss : null });
    } catch (err) {
      // SWALLOWED DELIBERATELY. This runs on a timer inside the HTTP process, so
      // an escaping rejection would be unhandled and could take the API down --
      // a monitoring feature causing the outage it exists to detect. A failed
      // evaluation costs one check; the next tick re-reads everything.
      app.log.warn({ err }, "heartbeat watchdog evaluation failed");
    }
  };

  app.decorate("runHeartbeatWatchdogOnce", runOnce);

  if (options.enabled === false) return;

  const timer = setInterval(() => {
    void runOnce();
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  // Never hold the process open on this timer's account: a shutdown must not
  // wait up to a minute for a monitoring tick.
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
