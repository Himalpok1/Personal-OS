import type { Db } from "@personal-os/db";

// Per-connection mutual exclusion for a Google Health sync pass.
//
// WHY AN ADVISORY LOCK AT ALL, GIVEN pg-boss ALREADY SERIALIZES:
//
// The queue is registered `policy: "stately"` with singletonKey = connection
// id, so pg-boss will not hand out two concurrent jobs for one connection. That
// is the first line of defence and it is a good one -- but it is not the only
// way a second pass can start. A manual "sync now" racing an activating
// scheduled job, a worker restart that leaves a job `active` past its
// expireInSeconds while the old process is still draining, or a second worker
// process (the architecture explicitly contemplates moving the worker to
// another box) all produce two passes over one connection.
//
// Two concurrent passes are not merely wasteful. They interleave densification
// and tombstoning across overlapping windows, which is exactly how a
// verified-absent marker gets written over a row the other pass is about to
// insert. The lock is what makes the ADR-046 authority rules mean anything
// under concurrency, so it is a correctness device rather than an optimization.
//
// It is also why the queue's expireInSeconds (900s) must stay strictly greater
// than the limiter's pass budget (600s): pg-boss un-`active`ing a job whose
// handler still holds this lock would make every subsequent pass skip.

/**
 * Namespace half of the two-argument advisory-lock key.
 *
 * The TWO-argument form -- `pg_try_advisory_lock(int4, int4)` -- is used
 * deliberately. The one-argument bigint form shares a single global key space
 * with every other advisory lock in the database, so a future feature hashing
 * some unrelated identifier could collide with a connection id and block health
 * syncs forever with no error surfacing anywhere. A dedicated namespace makes
 * that collision impossible outside this module.
 */
export const HEALTH_SYNC_LOCK_NAMESPACE = 6003;

export type LockOutcome<T> = { acquired: false } | { acquired: true; result: T };

/**
 * Runs `fn` while holding the per-connection advisory lock, or reports that
 * another pass already holds it.
 *
 * `pg_try_advisory_lock`, never `pg_advisory_lock`: a blocking acquire would
 * park a worker slot behind a pass that may run for the full ten-minute limiter
 * budget, and the correct behaviour when another pass is already running is to
 * do nothing at all -- the other pass covers the same windows.
 */
export async function withConnectionLock<T>(
  db: Db,
  connectionId: string,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  // A DEDICATED client, not `db`. A session-scoped advisory lock belongs to the
  // session that took it, and Drizzle's pool hands out an arbitrary connection
  // per statement -- so acquiring on one pooled connection and releasing from
  // another would leak the lock permanently. Pinning one client for the whole
  // pass is the only way acquire and release provably share a session.
  //
  // Not annotated with an explicit `pg` type on purpose: `pg` is not a direct
  // dependency of apps/worker and is not resolvable from here under pnpm's
  // strict layout. The type is inferred through @personal-os/db's `Db`.
  const client = await db.$client.connect();

  let acquired = false;
  try {
    const acquire = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1, hashtext($2)) as locked",
      [HEALTH_SYNC_LOCK_NAMESPACE, connectionId],
    );
    acquired = acquire.rows[0]?.locked === true;
    if (!acquired) return { acquired: false };

    return { acquired: true, result: await fn() };
  } finally {
    if (acquired) {
      // THE RELEASE PATH IS THE DANGEROUS HALF, AND `release(destroy)` IS WHY.
      //
      // Two distinct failure shapes both end with a connection that still holds
      // the lock being handed back to the pool. Returning it healthy means the
      // NEXT pass for this connection borrows a session that already owns the
      // lock -- pg_try_advisory_lock is re-entrant within a session, so it
      // would succeed and two passes would run concurrently -- or, worse, some
      // other pass borrows it and can never acquire. Either way the fault is
      // permanent and silent.
      //
      // Destroying the client instead removes it from the pool entirely, and
      // Postgres releases every session-scoped advisory lock when the backend
      // goes away. The cost is one re-established connection; the alternative
      // is a lock leak that survives until the process restarts.
      let destroy = false;
      try {
        const released = await client.query<{ ok: boolean }>(
          "select pg_advisory_unlock($1, hashtext($2)) as ok",
          [HEALTH_SYNC_LOCK_NAMESPACE, connectionId],
        );
        // `false` means this session did not hold the lock -- i.e. our
        // bookkeeping and Postgres's disagree, which is itself a reason not to
        // trust the connection.
        if (released.rows[0]?.ok !== true) destroy = true;
      } catch {
        destroy = true;
      } finally {
        client.release(destroy);
      }
    } else {
      client.release();
    }
  }
}
