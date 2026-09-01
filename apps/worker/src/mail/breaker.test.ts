import { mailSyncRuns, type Db } from "@personal-os/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { seedMailConnection, seedMailCursor } from "../test/mail-fixtures.js";
import {
  evaluateMailBreaker,
  MAIL_BREAKER_COOLDOWN_MS,
  MAIL_BREAKER_THRESHOLD,
} from "./breaker.js";

const db: Db = buildTestDb();
const SCOPE = "mailbox";
const BASE = new Date("2026-09-01T00:00:00.000Z");

/** Writes a settled run row `minutesAgo` before `BASE`. */
async function writeRun(
  connectionId: string,
  cursorId: string,
  opts: {
    status: "succeeded" | "failed" | "skipped" | "cancelled";
    failureClass?: string | null;
    minutesAgo: number;
    scopeKey?: string;
  },
): Promise<void> {
  const at = new Date(BASE.getTime() - opts.minutesAgo * 60_000);
  await db.insert(mailSyncRuns).values({
    connectionId,
    cursorId,
    scopeKey: opts.scopeKey ?? SCOPE,
    kind: "incremental",
    status: opts.status,
    failureClass: opts.failureClass ?? null,
    startedAt: at,
    finishedAt: at,
  });
}

/** N identical failures, newest last-written, oldest first. */
async function writeFailureStreak(
  connectionId: string,
  cursorId: string,
  failureClass: string,
  count: number,
  startMinutesAgo = 100,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await writeRun(connectionId, cursorId, {
      status: "failed",
      failureClass,
      minutesAgo: startMinutesAgo - i * 10,
    });
  }
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("evaluateMailBreaker", () => {
  it("stays closed with fewer than the threshold of runs", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD - 1);

    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(false);
    expect(state.justOpened).toBe(false);
  });

  it("opens on N identical non-retryable failures, and says it just opened", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD);

    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(true);
    expect(state.failureClass).toBe("missing_scope");
    expect(state.justOpened).toBe(true);
    expect(state.probing).toBe(false);
  });

  it("stops saying justOpened once the streak is longer than the threshold", async () => {
    // Edge-triggered on purpose. A level-triggered signal would fire on every
    // re-probe failure -- four times a day, forever -- which is the alert
    // fatigue that makes people mute a channel.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD + 1);

    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(true);
    expect(state.justOpened).toBe(false);
  });

  it("NEVER trips on a retryable class, however many times it repeats", async () => {
    // Disabling a mailbox because the provider is rate limiting us, or because
    // a socket reset, would be responding to weather.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);

    for (const failureClass of [
      "rate_limited:429",
      "rate_limited:403",
      "transport",
      "transport:timeout",
      "provider_unavailable:503",
      "oauth_transient",
      "auth_rejected",
      "pass_budget_exhausted",
    ]) {
      await db.delete(mailSyncRuns);
      await writeFailureStreak(connection.id, cursor.id, failureClass, MAIL_BREAKER_THRESHOLD + 2);
      const state = await evaluateMailBreaker(
        db,
        { connectionId: connection.id, scopeKey: SCOPE },
        BASE,
      );
      expect(state.open, `${failureClass} must not trip the breaker`).toBe(false);
    }
  });

  it("does not trip on a FLAPPING scope alternating between two faults", async () => {
    // A different problem with a different answer. Only a stable, reproducible
    // fault is evidence that the request itself is wrong.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    for (let i = 0; i < MAIL_BREAKER_THRESHOLD; i++) {
      await writeRun(connection.id, cursor.id, {
        status: "failed",
        failureClass: i % 2 === 0 ? "missing_scope" : "invalid_request",
        minutesAgo: 100 - i * 10,
      });
    }

    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(false);
  });

  it("closes as soon as one success lands", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD);
    await writeRun(connection.id, cursor.id, { status: "succeeded", minutesAgo: 1 });

    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(false);
  });

  it("EXCLUDES its own skipped rows, or it would close the breaker it just opened", async () => {
    // The load-bearing exclusion. An open breaker writes a `skipped` run row for
    // the audit trail; a window that counted it would see [skipped, failed x4],
    // find the newest row not-failed, and close -- flapping open/closed forever
    // and re-probing every single tick.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD);

    const beforeSkip = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(beforeSkip.open).toBe(true);

    // Three ticks' worth of skips, exactly what the orchestrator writes.
    for (let i = 0; i < 3; i++) {
      await writeRun(connection.id, cursor.id, {
        status: "skipped",
        failureClass: "breaker_open",
        minutesAgo: 5 - i,
      });
    }

    const afterSkips = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(afterSkips.open).toBe(true);
    expect(afterSkips.failureClass).toBe("missing_scope");
    // And it still does not re-alert.
    expect(afterSkips.justOpened).toBe(false);
  });

  it("re-probes once the cooldown has elapsed, so a fixed fault heals itself", async () => {
    // Without this, a connection whose scope was re-granted would stay dead
    // until a human noticed -- which for a self-hosted single-user system means
    // never.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD);

    const newestRunAt = BASE.getTime() - 60 * 60_000;
    const justAfter = new Date(newestRunAt + MAIL_BREAKER_COOLDOWN_MS + 1000);
    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      justAfter,
    );

    expect(state.probing).toBe(true);
    // `open` false is what lets the pass through; the breaker is still
    // conceptually open, and a failed probe leaves the window unchanged.
    expect(state.open).toBe(false);
    expect(state.failureClass).toBe("missing_scope");
  });

  it("keeps refusing right up to the cooldown boundary", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    await writeFailureStreak(connection.id, cursor.id, "missing_scope", MAIL_BREAKER_THRESHOLD);

    // Measured from the NEWEST run, not from BASE: writeFailureStreak's last
    // row lands 60 minutes before BASE, so anchoring on BASE would silently be
    // an hour past the boundary and the test would assert the wrong side of it.
    const newestRunAt = BASE.getTime() - 60 * 60_000;
    const justBefore = new Date(newestRunAt + MAIL_BREAKER_COOLDOWN_MS - 1000);
    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      justBefore,
    );
    expect(state.open).toBe(true);
    expect(state.probing).toBe(false);
  });

  it("scopes the window to one connection", async () => {
    const a = await seedMailConnection(db, { externalAccountId: "a@example.test" });
    const b = await seedMailConnection(db, { externalAccountId: "b@example.test" });
    const cursorA = await seedMailCursor(db, a.id);
    await seedMailCursor(db, b.id);

    await writeFailureStreak(a.id, cursorA.id, "missing_scope", MAIL_BREAKER_THRESHOLD);

    expect(
      (await evaluateMailBreaker(db, { connectionId: a.id, scopeKey: SCOPE }, BASE)).open,
    ).toBe(true);
    // One mailbox's dead grant must not stop the other mailbox syncing.
    expect(
      (await evaluateMailBreaker(db, { connectionId: b.id, scopeKey: SCOPE }, BASE)).open,
    ).toBe(false);
  });

  it("scopes the window to one scope key on the same connection", async () => {
    // Gmail has exactly one scope today, but the column exists because Graph's
    // delta cursor is per-folder -- so a per-folder fault must not disable a
    // sibling folder that is working.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    for (let i = 0; i < MAIL_BREAKER_THRESHOLD; i++) {
      await writeRun(connection.id, cursor.id, {
        status: "failed",
        failureClass: "missing_scope",
        minutesAgo: 100 - i * 10,
        scopeKey: "other-folder",
      });
    }

    expect(
      (await evaluateMailBreaker(db, { connectionId: connection.id, scopeKey: SCOPE }, BASE)).open,
    ).toBe(false);
    expect(
      (
        await evaluateMailBreaker(
          db,
          { connectionId: connection.id, scopeKey: "other-folder" },
          BASE,
        )
      ).open,
    ).toBe(true);
  });

  it("ignores a failure with no class at all", async () => {
    // A null class cannot be "identical" to anything, and treating it as one
    // would let five differently-broken passes trip a breaker together.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    for (let i = 0; i < MAIL_BREAKER_THRESHOLD; i++) {
      await writeRun(connection.id, cursor.id, {
        status: "failed",
        failureClass: null,
        minutesAgo: 100 - i * 10,
      });
    }
    const state = await evaluateMailBreaker(
      db,
      { connectionId: connection.id, scopeKey: SCOPE },
      BASE,
    );
    expect(state.open).toBe(false);
  });
});
