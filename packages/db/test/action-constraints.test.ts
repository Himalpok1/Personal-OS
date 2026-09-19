import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Proof that migration 0024's constraints (Checkpoint 10.8, ADR-078) actually
// BITE against a real Postgres, rather than merely being declared in Drizzle
// and in SQL.
//
// Follows mail-constraints.test.ts exactly -- root-.env loading, a migrator
// client for seeding and an app-role client for the runtime-privilege checks,
// and a refusal to run against anything that does not look like a test
// database.

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const migratorUrl = process.env["TEST_MIGRATIONS_DATABASE_URL"];
const appUrl = process.env["TEST_DATABASE_URL"];

for (const [name, url] of [
  ["TEST_MIGRATIONS_DATABASE_URL", migratorUrl],
  ["TEST_DATABASE_URL", appUrl],
] as const) {
  if (url && !/test/i.test(url)) {
    throw new Error(
      `action-constraints.test.ts resolved ${name} to a connection string that does not look like a test database -- refusing to run against it`,
    );
  }
}

const SQLSTATE = {
  checkViolation: "23514",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  notNullViolation: "23502",
  insufficientPrivilege: "42501",
} as const;

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

describeIf("migration 0024 constraints", () => {
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
    await db.query("delete from action_requests");
    await db.query("delete from agents");
    await db.query("delete from permission_grants");
  });

  async function insertGrant(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      principal: "app",
      permission: "tasks.write",
      disclosure_version: "2026-09-17",
      revoked_at: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into permission_grants (principal, permission, disclosure_version, revoked_at)
       values ($1, $2, $3, $4) returning id`,
      [row.principal, row.permission, row.disclosure_version, row.revoked_at],
    );
    return rows[0]!.id;
  }

  async function insertRequest(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      id: crypto.randomUUID(),
      client_uuid: null,
      action_id: "create_task",
      principal: "app",
      status: "pending",
      source: "manual",
      input: { title: "x", timezone: "UTC" },
      input_summary: "Create task",
      target_type: null,
      target_id: null,
      reverses_request_id: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into action_requests (id, client_uuid, action_id, principal, status, source, input, input_summary, target_type, target_id, reverses_request_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + interval '1 day') returning id`,
      [
        row.id,
        row.client_uuid,
        row.action_id,
        row.principal,
        row.status,
        row.source,
        JSON.stringify(row.input),
        row.input_summary,
        row.target_type,
        row.target_id,
        row.reverses_request_id,
      ],
    );
    return rows[0]!.id;
  }

  describe("permission_grants", () => {
    it("allows at most one LIVE grant per (principal, permission) while keeping revoked history", async () => {
      await insertGrant();
      await expectSqlState(() => insertGrant(), SQLSTATE.uniqueViolation);
      await db.query("update permission_grants set revoked_at = now()");
      await expect(insertGrant({ disclosure_version: "2026-10-01" })).resolves.toBeTruthy();
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from permission_grants",
      );
      expect(rows[0]!.n).toBe(2);
    });

    it("REJECTS a principal outside app|agent and accepts both members", async () => {
      await expectSqlState(() => insertGrant({ principal: "robot" }), SQLSTATE.checkViolation);
      await expect(insertGrant({ principal: "agent" })).resolves.toBeTruthy();
    });

    it("does NOT CHECK the permission vocabulary -- it is Zod-enforced (ADR-050)", async () => {
      await expect(insertGrant({ permission: "future.write" })).resolves.toBeTruthy();
    });
  });

  describe("action_requests", () => {
    it("accepts every status and source the schema defines", async () => {
      for (const status of [
        "pending",
        "executing",
        "completed",
        "failed",
        "cancelled",
        "expired",
      ]) {
        await expect(insertRequest({ status })).resolves.toBeTruthy();
      }
      for (const source of ["focus_now", "briefing", "academic", "manual"]) {
        await expect(insertRequest({ source })).resolves.toBeTruthy();
      }
      // `agent` (0025) needs an agent row; agent-constraints.test.ts covers the pair.
    });

    it("REJECTS a status, source, principal or target_type outside the closed vocabularies", async () => {
      await expectSqlState(() => insertRequest({ status: "approved" }), SQLSTATE.checkViolation);
      await expectSqlState(() => insertRequest({ source: "model" }), SQLSTATE.checkViolation);
      await expectSqlState(() => insertRequest({ principal: "system" }), SQLSTATE.checkViolation);
      await expectSqlState(
        () => insertRequest({ target_type: "note", target_id: crypto.randomUUID() }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a half-set target pair", async () => {
      await expectSqlState(() => insertRequest({ target_type: "task" }), SQLSTATE.checkViolation);
      await expectSqlState(
        () => insertRequest({ target_id: crypto.randomUUID() }),
        SQLSTATE.checkViolation,
      );
      await expect(
        insertRequest({ target_type: "task", target_id: crypto.randomUUID() }),
      ).resolves.toBeTruthy();
    });

    it("REJECTS a self-reversal, an unknown reversal, and SETS NULL when the reversed row is deleted", async () => {
      const id = crypto.randomUUID();
      await expectSqlState(
        () => insertRequest({ id, reverses_request_id: id }),
        SQLSTATE.checkViolation,
      );
      await expectSqlState(
        () => insertRequest({ reverses_request_id: crypto.randomUUID() }),
        SQLSTATE.foreignKeyViolation,
      );
      const original = await insertRequest({ status: "completed" });
      const undo = await insertRequest({
        action_id: "archive_task",
        reverses_request_id: original,
      });
      await app.query("delete from action_requests where id = $1", [original]);
      const { rows } = await db.query<{ reverses_request_id: string | null }>(
        "select reverses_request_id from action_requests where id = $1",
        [undo],
      );
      expect(rows[0]!.reverses_request_id).toBeNull();
    });

    it("dedupes on client_uuid only when one is present", async () => {
      const clientUuid = crypto.randomUUID();
      await insertRequest({ client_uuid: clientUuid });
      await expectSqlState(
        () => insertRequest({ client_uuid: clientUuid }),
        SQLSTATE.uniqueViolation,
      );
      await expect(insertRequest()).resolves.toBeTruthy();
      await expect(insertRequest()).resolves.toBeTruthy();
    });

    it("REJECTS a null input, input_summary or expires_at", async () => {
      await expectSqlState(
        () =>
          db.query(
            `insert into action_requests (action_id, principal, source, input, input_summary, expires_at)
             values ('create_task', 'app', 'manual', '{}', 'x', null)`,
          ),
        SQLSTATE.notNullViolation,
      );
      await expectSqlState(
        () =>
          db.query(
            `insert into action_requests (action_id, principal, source, input, input_summary, expires_at)
             values ('create_task', 'app', 'manual', '{}', null, now())`,
          ),
        SQLSTATE.notNullViolation,
      );
    });

    it("the runtime role can insert, update and delete both tables through default privileges (no GRANT in the migration)", async () => {
      const { rows } = await app.query<{ id: string }>(
        `insert into action_requests (action_id, principal, source, input, input_summary, expires_at)
         values ('create_task', 'app', 'manual', '{}', 'x', now()) returning id`,
      );
      await app.query("update action_requests set status = 'cancelled' where id = $1", [
        rows[0]!.id,
      ]);
      await app.query("delete from action_requests where id = $1", [rows[0]!.id]);
      const grant = await app.query<{ id: string }>(
        `insert into permission_grants (principal, permission, disclosure_version)
         values ('app', 'tasks.write', 'v') returning id`,
      );
      await app.query("delete from permission_grants where id = $1", [grant.rows[0]!.id]);
    });
  });
});
