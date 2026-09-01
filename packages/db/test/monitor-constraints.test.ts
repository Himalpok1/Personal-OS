import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Proof that migration 0015's constraints actually BITE against a real
// Postgres, rather than merely being declared in Drizzle and in SQL.
//
// Follows mail-constraints.test.ts exactly, including its root-.env loading and
// its refusal to run against anything that does not look like a test database.
//
// The most important case in this file is the PARTIAL UNIQUE INDEX on
// `monitor_incidents`. "At most one active incident per target" is the invariant
// the whole alerting design rests on -- two concurrent openers would mean two
// "service down" pushes and two incident ids for one outage -- and it is
// enforced by the DATABASE rather than by a read-then-write in application code,
// because a read-then-write cannot be correct under concurrency no matter how
// carefully it is written.

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const migratorUrl = process.env["TEST_MIGRATIONS_DATABASE_URL"];
const appUrl = process.env["TEST_DATABASE_URL"];

for (const [name, url] of [
  ["TEST_MIGRATIONS_DATABASE_URL", migratorUrl],
  ["TEST_DATABASE_URL", appUrl],
] as const) {
  if (url && !/test/i.test(url)) {
    throw new Error(
      `monitor-constraints.test.ts resolved ${name} to a connection string that does not look like a test database -- refusing to run against it`,
    );
  }
}

const SQLSTATE = {
  checkViolation: "23514",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  insufficientPrivilege: "42501",
} as const;

/** Runs `fn`, expecting it to fail with the given SQLSTATE. */
async function expectSqlState(fn: () => Promise<unknown>, code: string): Promise<void> {
  let caught: { code?: string } | undefined;
  try {
    await fn();
  } catch (err) {
    caught = err as { code?: string };
  }
  expect(caught, "expected the statement to fail, but it succeeded").toBeDefined();
  expect(caught?.code).toBe(code);
}

const describeIf = migratorUrl && appUrl ? describe : describe.skip;

describeIf("migration 0015 constraints", () => {
  let db: Client;
  let app: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: migratorUrl });
    await db.connect();
    app = new Client({ connectionString: appUrl });
    await app.connect();
  });

  afterAll(async () => {
    await db.end();
    await app.end();
  });

  afterEach(async () => {
    // FK-safe order; the cascades make this readable rather than required.
    await db.query("delete from monitor_checks");
    await db.query("delete from monitor_incidents");
    await db.query("delete from monitor_targets");
  });

  async function insertTarget(overrides: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      name: `t-${Math.random().toString(36).slice(2)}`,
      kind: "http",
      url: "http://api:3000/health",
      ...overrides,
    };
    const columns = Object.keys(row);
    const { rows } = await db.query<{ id: string }>(
      `insert into monitor_targets (${columns.join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      columns.map((c) => row[c]),
    );
    return rows[0]!.id;
  }

  async function insertIncident(
    targetId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const row: Record<string, unknown> = { target_id: targetId, status: "open", ...overrides };
    const columns = Object.keys(row);
    const { rows } = await db.query<{ id: string }>(
      `insert into monitor_incidents (${columns.join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      columns.map((c) => row[c]),
    );
    return rows[0]!.id;
  }

  // -------------------------------------------------------------------
  // monitor_targets
  // -------------------------------------------------------------------

  describe("monitor_targets", () => {
    it("accepts both kinds", async () => {
      await expect(insertTarget({ kind: "http" })).resolves.toBeTruthy();
      await expect(insertTarget({ kind: "worker_heartbeat", url: null })).resolves.toBeTruthy();
    });

    it("REJECTS a kind outside the closed vocabulary", async () => {
      // CHECKed rather than Zod-only because the two-member set is fully
      // project-controlled and closed by design (ADR-050). A third kind would be
      // a schema change with its own migration, not a config value.
      await expectSqlState(() => insertTarget({ kind: "tcp" }), SQLSTATE.checkViolation);
    });

    it("REJECTS a duplicate name", async () => {
      await insertTarget({ name: "api-internal-health" });
      await expectSqlState(
        () => insertTarget({ name: "api-internal-health" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("REJECTS non-positive timing and threshold values", async () => {
      // A zero interval would make the pass probe on every tick regardless of
      // configuration; a zero failure threshold would open an incident from an
      // empty history, before a single check had been recorded.
      for (const column of [
        "timeout_ms",
        "interval_seconds",
        "failure_threshold",
        "recovery_threshold",
      ]) {
        await expectSqlState(() => insertTarget({ [column]: 0 }), SQLSTATE.checkViolation);
        await expectSqlState(() => insertTarget({ [column]: -1 }), SQLSTATE.checkViolation);
      }
    });

    it("REJECTS a partially-populated maintenance window", async () => {
      // A window with a start and no zone is undecidable: `isWithinQuietHours`
      // needs all three, so a partial triple would silently never suppress and
      // the operator would believe it was configured.
      const triples: Record<string, unknown>[] = [
        { maintenance_start: "01:00" },
        { maintenance_end: "02:00" },
        { maintenance_timezone: "America/Chicago" },
        { maintenance_start: "01:00", maintenance_end: "02:00" },
        { maintenance_start: "01:00", maintenance_timezone: "America/Chicago" },
        { maintenance_end: "02:00", maintenance_timezone: "America/Chicago" },
      ];
      for (const partial of triples) {
        await expectSqlState(() => insertTarget(partial), SQLSTATE.checkViolation);
      }
    });

    it("ACCEPTS a complete maintenance window, and none at all", async () => {
      await expect(
        insertTarget({
          maintenance_start: "01:00",
          maintenance_end: "02:00",
          maintenance_timezone: "America/Chicago",
        }),
      ).resolves.toBeTruthy();
      await expect(insertTarget()).resolves.toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // monitor_checks
  // -------------------------------------------------------------------

  describe("monitor_checks", () => {
    it("accepts all three statuses, INCLUDING skipped", async () => {
      const targetId = await insertTarget();
      for (const status of ["up", "down", "skipped"]) {
        await expect(
          db.query("insert into monitor_checks (target_id, status) values ($1, $2)", [
            targetId,
            status,
          ]),
        ).resolves.toBeTruthy();
      }
    });

    it("REJECTS a status outside the closed set", async () => {
      const targetId = await insertTarget();
      await expectSqlState(
        () =>
          db.query("insert into monitor_checks (target_id, status) values ($1, $2)", [
            targetId,
            "unknown",
          ]),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a negative latency", async () => {
      const targetId = await insertTarget();
      await expectSqlState(
        () =>
          db.query(
            "insert into monitor_checks (target_id, status, latency_ms) values ($1, 'up', $2)",
            [targetId, -1],
          ),
        SQLSTATE.checkViolation,
      );
    });

    it("ACCEPTS a null latency, because a check that never connected has none", async () => {
      // Zero and null are genuinely different here: zero is an impossibly fast
      // response, null is "we never got one". Collapsing them would put a
      // fictional 0ms into any latency chart.
      const targetId = await insertTarget();
      await expect(
        db.query(
          "insert into monitor_checks (target_id, status, latency_ms) values ($1, 'down', null)",
          [targetId],
        ),
      ).resolves.toBeTruthy();
    });

    it("REJECTS a check for a target that does not exist", async () => {
      await expectSqlState(
        () =>
          db.query("insert into monitor_checks (target_id, status) values ($1, 'up')", [
            "00000000-0000-0000-0000-000000000000",
          ]),
        SQLSTATE.foreignKeyViolation,
      );
    });

    it("does NOT constrain failure_class, so a new class needs no migration", async () => {
      // ADR-050: CHECK only vocabularies that are closed by design. Failure
      // classes are expected to grow with every provider and probe type, and
      // `reconcile-drizzle-tracking.ts` cannot process `DROP CONSTRAINT` -- so
      // CHECKing this set would make widening it an unreconcilable migration.
      // The shape is enforced in Zod instead.
      const targetId = await insertTarget();
      await expect(
        db.query(
          "insert into monitor_checks (target_id, status, failure_class) values ($1, 'down', $2)",
          [targetId, "a_class_invented_after_this_migration_shipped"],
        ),
      ).resolves.toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // monitor_incidents
  // -------------------------------------------------------------------

  describe("monitor_incidents", () => {
    it("REJECTS a status outside the closed lifecycle", async () => {
      const targetId = await insertTarget();
      await expectSqlState(
        () => insertIncident(targetId, { status: "closed" }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS an open incident that carries a resolved_at", async () => {
      const targetId = await insertTarget();
      await expectSqlState(
        () => insertIncident(targetId, { status: "open", resolved_at: new Date() }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a resolved incident with no resolved_at", async () => {
      // Without this, a resolved incident could carry no resolution time -- and
      // the partial unique index keys on `resolved_at is null`, so such a row
      // would keep occupying the target's active slot forever and no future
      // outage could ever be opened.
      const targetId = await insertTarget();
      await expectSqlState(
        () => insertIncident(targetId, { status: "resolved", resolved_at: null }),
        SQLSTATE.checkViolation,
      );
    });

    it("ACCEPTS acknowledged as an ACTIVE state", async () => {
      // Acknowledgement silences nothing and resolves nothing; it records that a
      // human has seen it. Treating it as terminal would let a second alert fire
      // for an outage someone is already working on.
      const targetId = await insertTarget();
      await expect(insertIncident(targetId, { status: "acknowledged" })).resolves.toBeTruthy();
    });

    it("ENFORCES at most one active incident per target", async () => {
      const targetId = await insertTarget();
      await insertIncident(targetId, { status: "open" });
      await expectSqlState(
        () => insertIncident(targetId, { status: "open" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("counts an ACKNOWLEDGED incident against that one active slot", async () => {
      const targetId = await insertTarget();
      await insertIncident(targetId, { status: "acknowledged" });
      await expectSqlState(
        () => insertIncident(targetId, { status: "open" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("ALLOWS unlimited RESOLVED incidents for the same target", async () => {
      // The index is partial on `resolved_at is null` precisely so history
      // accumulates: a target that has been down five times has five incident
      // rows, and each one alerted under its own dedupe key.
      const targetId = await insertTarget();
      for (let i = 0; i < 3; i += 1) {
        await expect(
          insertIncident(targetId, { status: "resolved", resolved_at: new Date() }),
        ).resolves.toBeTruthy();
      }
      // And the slot is free again.
      await expect(insertIncident(targetId, { status: "open" })).resolves.toBeTruthy();
    });

    it("scopes the active slot PER TARGET", async () => {
      const first = await insertTarget();
      const second = await insertTarget();
      await expect(insertIncident(first)).resolves.toBeTruthy();
      await expect(insertIncident(second)).resolves.toBeTruthy();
    });

    it("cascades to checks and incidents when a target is deleted", async () => {
      const targetId = await insertTarget();
      await db.query("insert into monitor_checks (target_id, status) values ($1, 'up')", [
        targetId,
      ]);
      await insertIncident(targetId);

      await db.query("delete from monitor_targets where id = $1", [targetId]);

      for (const table of ["monitor_checks", "monitor_incidents"]) {
        const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table}`);
        expect(rows[0]!.n).toBe("0");
      }
    });
  });

  // -------------------------------------------------------------------
  // Role separation
  // -------------------------------------------------------------------

  describe("least privilege", () => {
    it("lets the runtime role read and write monitoring rows", async () => {
      // The worker and the API both write checks and incidents at runtime, so
      // DML must work as posops_app -- a monitoring system the app role cannot
      // record into would fail silently in production and pass every test that
      // used the migrator connection.
      await app.query("begin");
      const { rows } = await app.query<{ id: string }>(
        `insert into monitor_targets (name, kind, url) values ($1, 'http', 'http://api:3000/health')
         returning id`,
        [`app-${Math.random().toString(36).slice(2)}`],
      );
      await expect(
        app.query("insert into monitor_checks (target_id, status) values ($1, 'up')", [
          rows[0]!.id,
        ]),
      ).resolves.toBeTruthy();
      await app.query("rollback");
    });

    it("DENIES the runtime role any DDL on the monitoring tables", async () => {
      await expectSqlState(
        () => app.query("alter table monitor_targets drop constraint monitor_targets_kind"),
        SQLSTATE.insufficientPrivilege,
      );
      await expectSqlState(
        () => app.query("create table monitor_should_fail (id int)"),
        SQLSTATE.insufficientPrivilege,
      );
    });
  });
});
