import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Proof that migration 0014's constraints actually BITE against a real
// Postgres, rather than merely being declared in Drizzle and in SQL.
//
// Follows date-type-parser.test.ts exactly -- the existing precedent for a
// database-connecting test in this package -- including its root-.env loading
// and its refusal to run against anything that does not look like a test
// database.

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const migratorUrl = process.env["TEST_MIGRATIONS_DATABASE_URL"];
const appUrl = process.env["TEST_DATABASE_URL"];

for (const [name, url] of [
  ["TEST_MIGRATIONS_DATABASE_URL", migratorUrl],
  ["TEST_DATABASE_URL", appUrl],
] as const) {
  // Defense in depth against a misconfigured environment silently pointing
  // these writes at dev.
  if (url && !/test/i.test(url)) {
    throw new Error(
      `mail-constraints.test.ts resolved ${name} to a connection string that does not look like a test database -- refusing to run against it`,
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

describeIf("migration 0014 constraints", () => {
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
    // FK-safe order, matching both test harnesses.
    await db.query("delete from mail_sync_runs");
    await db.query("delete from mail_messages");
    await db.query("delete from mail_sync_cursors");
    await db.query("delete from mail_connections");
    await db.query("delete from mail_digests");
    await db.query("delete from mail_oauth_states");
  });

  async function insertConnection(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      provider: "gmail",
      external_account_id: `person+${Math.random().toString(36).slice(2)}@example.com`,
      status: "active",
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into mail_connections (provider, external_account_id, status)
       values ($1, $2, $3) returning id`,
      [row.provider, row.external_account_id, row.status],
    );
    return rows[0]!.id;
  }

  // -------------------------------------------------------------------
  // mail_connections
  // -------------------------------------------------------------------

  describe("mail_connections", () => {
    it("accepts each of the four lifecycle statuses", async () => {
      for (const status of ["active", "needs_reauth", "revoked", "disconnected"]) {
        await expect(insertConnection({ status })).resolves.toBeTruthy();
      }
    });

    it("REJECTS a status outside the closed lifecycle", async () => {
      await expectSqlState(
        () => insertConnection({ status: "connected" }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a duplicate (provider, external_account_id)", async () => {
      await insertConnection({ external_account_id: "dupe@example.com" });
      await expectSqlState(
        () => insertConnection({ external_account_id: "dupe@example.com" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("ALLOWS the same address under a different provider", async () => {
      // The key is (provider, external_account_id), not the address alone --
      // deliberately unlike health_connections, which is unique on the account
      // id by itself. A second provider could mint a colliding account id.
      await insertConnection({ external_account_id: "shared@example.com" });
      await expect(
        insertConnection({ provider: "other_provider", external_account_id: "shared@example.com" }),
      ).resolves.toBeTruthy();
    });

    it("does NOT constrain provider, so a second provider needs no DROP CONSTRAINT", async () => {
      // ADR-050: reconcile-drizzle-tracking.ts cannot process DROP CONSTRAINT,
      // so a CHECK here would make admitting Microsoft Graph an unreconcilable
      // migration. Zod enforces the vocabulary instead.
      await expect(insertConnection({ provider: "microsoft_graph" })).resolves.toBeTruthy();
    });

    it("REJECTS a null external_account_id", async () => {
      // NOT NULL because a Postgres unique index permits unlimited NULLs, so a
      // nullable identity would let a partially-failed connect bypass the
      // account-mismatch guard entirely.
      await expectSqlState(
        () =>
          db.query(
            `insert into mail_connections (provider, external_account_id) values ('gmail', null)`,
          ),
        SQLSTATE.notNullViolation,
      );
    });

    it("ACCEPTS a complete credential triple and a fully absent one", async () => {
      const id = await insertConnection();
      await expect(
        db.query(
          `update mail_connections set access_token_ciphertext = $1, access_token_iv = $2,
             access_token_auth_tag = $3 where id = $4`,
          [Buffer.from("ct"), Buffer.from("iv"), Buffer.from("tag"), id],
        ),
      ).resolves.toBeTruthy();
      await expect(
        db.query(
          `update mail_connections set access_token_ciphertext = null, access_token_iv = null,
             access_token_auth_tag = null where id = $1`,
          [id],
        ),
      ).resolves.toBeTruthy();
    });

    it("REJECTS every partially-populated credential triple", async () => {
      // A partial triple is undecryptable, so it must be unrepresentable rather
      // than merely unlikely. calendar_connections lacks this; health added it,
      // and mail copies health.
      const id = await insertConnection();
      const ct = Buffer.from("ct");
      const iv = Buffer.from("iv");
      const tag = Buffer.from("tag");
      const partials: [Buffer | null, Buffer | null, Buffer | null][] = [
        [ct, null, null],
        [null, iv, null],
        [null, null, tag],
        [ct, iv, null],
        [ct, null, tag],
        [null, iv, tag],
      ];
      for (const [c, i, t] of partials) {
        await expectSqlState(
          () =>
            db.query(
              `update mail_connections set access_token_ciphertext = $1, access_token_iv = $2,
                 access_token_auth_tag = $3 where id = $4`,
              [c, i, t, id],
            ),
          SQLSTATE.checkViolation,
        );
      }
    });

    it("enforces the refresh triple independently of the access triple", async () => {
      const id = await insertConnection();
      await expectSqlState(
        () =>
          db.query(`update mail_connections set refresh_token_ciphertext = $1 where id = $2`, [
            Buffer.from("ct"),
            id,
          ]),
        SQLSTATE.checkViolation,
      );
    });
  });

  // -------------------------------------------------------------------
  // mail_sync_cursors
  // -------------------------------------------------------------------

  describe("mail_sync_cursors", () => {
    it("REJECTS a duplicate (connection_id, scope_key)", async () => {
      const connectionId = await insertConnection();
      await db.query(
        `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
         values ($1, 'INBOX', 'gmail_history_id')`,
        [connectionId],
      );
      await expectSqlState(
        () =>
          db.query(
            `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
             values ($1, 'INBOX', 'gmail_history_id')`,
            [connectionId],
          ),
        SQLSTATE.uniqueViolation,
      );
    });

    it("defaults needs_full_resync to TRUE, because a cursorless row genuinely needs one", async () => {
      const connectionId = await insertConnection();
      const { rows } = await db.query<{ needs_full_resync: boolean; cursor_value: string | null }>(
        `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
         values ($1, 'INBOX', 'gmail_history_id')
         returning needs_full_resync, cursor_value`,
        [connectionId],
      );
      expect(rows[0]?.needs_full_resync).toBe(true);
      expect(rows[0]?.cursor_value).toBeNull();
    });

    it("stores the cursor as an opaque string, preserving leading zeros", async () => {
      const connectionId = await insertConnection();
      const { rows } = await db.query<{ cursor_value: string }>(
        `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind, cursor_value)
         values ($1, 'INBOX', 'gmail_history_id', '0000123') returning cursor_value`,
        [connectionId],
      );
      // A numeric column would have destroyed this. The cursor is provider
      // state, not a number we own.
      expect(rows[0]?.cursor_value).toBe("0000123");
    });

    it("CASCADES from mail_connections", async () => {
      const connectionId = await insertConnection();
      await db.query(
        `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
         values ($1, 'INBOX', 'gmail_history_id')`,
        [connectionId],
      );
      await db.query("delete from mail_connections where id = $1", [connectionId]);
      const { rows } = await db.query("select 1 from mail_sync_cursors");
      expect(rows).toHaveLength(0);
    });

    it("REJECTS a cursor for a connection that does not exist", async () => {
      await expectSqlState(
        () =>
          db.query(
            `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
             values ('00000000-0000-4000-8000-000000000000', 'INBOX', 'gmail_history_id')`,
          ),
        SQLSTATE.foreignKeyViolation,
      );
    });
  });

  // -------------------------------------------------------------------
  // mail_messages
  // -------------------------------------------------------------------

  describe("mail_messages", () => {
    async function insertMessage(
      connectionId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<void> {
      const row = {
        external_id: `m-${Math.random().toString(36).slice(2)}`,
        thread_id: "t1",
        internal_date: "2026-08-30T09:15:00Z",
        content_hash: "hash",
        ...overrides,
      };
      await db.query(
        `insert into mail_messages
           (connection_id, external_id, thread_id, internal_date, content_hash, size_estimate)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          connectionId,
          row.external_id,
          row.thread_id,
          row.internal_date,
          row.content_hash,
          (row as { size_estimate?: number }).size_estimate ?? null,
        ],
      );
    }

    it("REJECTS a duplicate (connection_id, external_id)", async () => {
      const connectionId = await insertConnection();
      await insertMessage(connectionId, { external_id: "dupe" });
      await expectSqlState(
        () => insertMessage(connectionId, { external_id: "dupe" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("ALLOWS the same external_id under a different connection", async () => {
      // Two mailboxes can legitimately hold provider ids that collide.
      const a = await insertConnection();
      const b = await insertConnection();
      await insertMessage(a, { external_id: "same" });
      await expect(insertMessage(b, { external_id: "same" })).resolves.toBeUndefined();
    });

    it("REJECTS a negative size_estimate", async () => {
      const connectionId = await insertConnection();
      await expectSqlState(
        () => insertMessage(connectionId, { size_estimate: -1 }),
        SQLSTATE.checkViolation,
      );
    });

    it("allows a null size_estimate", async () => {
      const connectionId = await insertConnection();
      await expect(insertMessage(connectionId, { size_estimate: null })).resolves.toBeUndefined();
    });

    it("defaults provider_labels to an empty array, never null", async () => {
      const connectionId = await insertConnection();
      await insertMessage(connectionId, { external_id: "labels" });
      const { rows } = await db.query<{ provider_labels: string[] }>(
        "select provider_labels from mail_messages where external_id = 'labels'",
      );
      expect(rows[0]?.provider_labels).toEqual([]);
    });

    it("has NO body, snippet or attachment-content column", async () => {
      // The security property, asserted against the live catalog rather than
      // against the migration text.
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'mail_messages'`,
      );
      const columns = rows.map((r) => r.column_name);
      for (const forbidden of [
        "body",
        "body_html",
        "body_text",
        "snippet",
        "payload",
        "raw",
        "attachment_content",
        "attachments",
      ]) {
        expect(columns).not.toContain(forbidden);
      }
      expect(columns).toContain("has_attachment");
      // provider_labels, not label_ids -- Gmail's vocabulary must not leak into
      // a provider-neutral column name.
      expect(columns).toContain("provider_labels");
      expect(columns).not.toContain("label_ids");
    });

    it("CASCADES from mail_connections", async () => {
      const connectionId = await insertConnection();
      await insertMessage(connectionId);
      await db.query("delete from mail_connections where id = $1", [connectionId]);
      const { rows } = await db.query("select 1 from mail_messages");
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // mail_digests
  // -------------------------------------------------------------------

  describe("mail_digests", () => {
    it("REJECTS a duplicate (digest_date, timezone)", async () => {
      await db.query(
        `insert into mail_digests (digest_date, timezone, content)
         values ('2026-08-30', 'America/Chicago', '{"text":"a"}'::jsonb)`,
      );
      await expectSqlState(
        () =>
          db.query(
            `insert into mail_digests (digest_date, timezone, content)
             values ('2026-08-30', 'America/Chicago', '{"text":"b"}'::jsonb)`,
          ),
        SQLSTATE.uniqueViolation,
      );
    });

    it("ALLOWS the same date in a different timezone", async () => {
      // The same instant is a different local calendar date in different zones.
      await db.query(
        `insert into mail_digests (digest_date, timezone, content)
         values ('2026-08-30', 'America/Chicago', '{"text":"a"}'::jsonb)`,
      );
      await expect(
        db.query(
          `insert into mail_digests (digest_date, timezone, content)
           values ('2026-08-30', 'Pacific/Auckland', '{"text":"b"}'::jsonb)`,
        ),
      ).resolves.toBeTruthy();
    });

    it("has NO connection_id: the digest is global across mailboxes", async () => {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'mail_digests'`,
      );
      expect(rows.map((r) => r.column_name)).not.toContain("connection_id");
    });

    it("SETS NULL rather than cascading when its ai_models row is deleted", async () => {
      // A deleted model must not take the digest's history with it.
      const { rows: conn } = await db.query<{ id: string }>(
        `insert into ai_provider_connections
           (name, provider_type, api_key_ciphertext, api_key_iv, api_key_auth_tag)
         values ('t', 'openai', $1, $2, $3) returning id`,
        [Buffer.from("c"), Buffer.from("i"), Buffer.from("a")],
      );
      const { rows: model } = await db.query<{ id: string }>(
        `insert into ai_models (provider_connection_id, model_id) values ($1, 'gpt-test')
         returning id`,
        [conn[0]!.id],
      );
      await db.query(
        `insert into mail_digests (digest_date, timezone, content, model_id)
         values ('2026-08-31', 'UTC', '{"text":"x"}'::jsonb, $1)`,
        [model[0]!.id],
      );
      await db.query("delete from ai_models where id = $1", [model[0]!.id]);
      const { rows } = await db.query<{ model_id: string | null }>(
        "select model_id from mail_digests where digest_date = '2026-08-31'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.model_id).toBeNull();
      await db.query("delete from ai_provider_connections where id = $1", [conn[0]!.id]);
    });
  });

  // -------------------------------------------------------------------
  // mail_sync_runs
  // -------------------------------------------------------------------

  describe("mail_sync_runs", () => {
    async function insertRun(
      connectionId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<void> {
      const row = { kind: "incremental", status: "succeeded", ...overrides };
      await db.query(
        `insert into mail_sync_runs
           (connection_id, scope_key, kind, status, range_start_at, range_end_at)
         values ($1, 'INBOX', $2, $3, $4, $5)`,
        [
          connectionId,
          row.kind,
          row.status,
          (row as { range_start_at?: string }).range_start_at ?? null,
          (row as { range_end_at?: string }).range_end_at ?? null,
        ],
      );
    }

    it("accepts each declared kind and status", async () => {
      const connectionId = await insertConnection();
      for (const kind of ["incremental", "full", "backfill", "manual"]) {
        await expect(insertRun(connectionId, { kind })).resolves.toBeUndefined();
      }
      for (const status of ["succeeded", "failed", "skipped", "cancelled"]) {
        await expect(insertRun(connectionId, { status })).resolves.toBeUndefined();
      }
    });

    it("REJECTS an undeclared kind or status", async () => {
      const connectionId = await insertConnection();
      await expectSqlState(() => insertRun(connectionId, { kind: "hot" }), SQLSTATE.checkViolation);
      await expectSqlState(
        () => insertRun(connectionId, { status: "running" }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a range that ends before it starts", async () => {
      const connectionId = await insertConnection();
      await expectSqlState(
        () =>
          insertRun(connectionId, {
            range_start_at: "2026-08-30T12:00:00Z",
            range_end_at: "2026-08-30T11:00:00Z",
          }),
        SQLSTATE.checkViolation,
      );
    });

    it("allows an absent range, because an incremental pass has a cursor rather than a range", async () => {
      const connectionId = await insertConnection();
      await expect(insertRun(connectionId)).resolves.toBeUndefined();
      await expect(
        insertRun(connectionId, { range_start_at: "2026-08-30T12:00:00Z" }),
      ).resolves.toBeUndefined();
    });

    it("SETS NULL on cursor deletion but CASCADES on connection deletion", async () => {
      // Deleting a cursor must not erase the evidence that syncs ran against
      // it; deleting the connection removes the whole audit trail with it.
      const connectionId = await insertConnection();
      const { rows: cur } = await db.query<{ id: string }>(
        `insert into mail_sync_cursors (connection_id, scope_key, cursor_kind)
         values ($1, 'INBOX', 'gmail_history_id') returning id`,
        [connectionId],
      );
      await db.query(
        `insert into mail_sync_runs (connection_id, cursor_id, scope_key, kind, status)
         values ($1, $2, 'INBOX', 'incremental', 'succeeded')`,
        [connectionId, cur[0]!.id],
      );
      await db.query("delete from mail_sync_cursors where id = $1", [cur[0]!.id]);
      const { rows: afterCursor } = await db.query<{ cursor_id: string | null }>(
        "select cursor_id from mail_sync_runs",
      );
      expect(afterCursor).toHaveLength(1);
      expect(afterCursor[0]?.cursor_id).toBeNull();

      await db.query("delete from mail_connections where id = $1", [connectionId]);
      const { rows: afterConnection } = await db.query("select 1 from mail_sync_runs");
      expect(afterConnection).toHaveLength(0);
    });

    it("records cursor_expired, making ADR-053's transition visible in the audit trail", async () => {
      const connectionId = await insertConnection();
      await db.query(
        `insert into mail_sync_runs
           (connection_id, scope_key, kind, status, cursor_expired, failure_class)
         values ($1, 'INBOX', 'incremental', 'failed', true, 'cursor_expired')`,
        [connectionId],
      );
      const { rows } = await db.query<{ cursor_expired: boolean; failure_class: string }>(
        "select cursor_expired, failure_class from mail_sync_runs",
      );
      expect(rows[0]?.cursor_expired).toBe(true);
      expect(rows[0]?.failure_class).toBe("cursor_expired");
    });

    it("does NOT constrain failure_class, which is expected to grow", async () => {
      // ADR-050 again: the diagnostic set grows, so it is Zod-shape-enforced
      // rather than CHECKed.
      const connectionId = await insertConnection();
      await expect(
        db.query(
          `insert into mail_sync_runs (connection_id, scope_key, kind, status, failure_class)
           values ($1, 'INBOX', 'incremental', 'failed', 'a_class_invented_later')`,
          [connectionId],
        ),
      ).resolves.toBeTruthy();
    });
  });

  // -------------------------------------------------------------------
  // Role separation
  // -------------------------------------------------------------------

  describe("role separation of duties", () => {
    it("lets the runtime role read and write every mail table", async () => {
      const { rows } = await app.query<{ id: string }>(
        `insert into mail_connections (provider, external_account_id)
         values ('gmail', 'approle@example.com') returning id`,
      );
      const id = rows[0]!.id;
      await expect(
        app.query("update mail_connections set status = 'needs_reauth' where id = $1", [id]),
      ).resolves.toBeTruthy();
      await expect(app.query("select 1 from mail_messages")).resolves.toBeTruthy();
      await app.query("delete from mail_connections where id = $1", [id]);
    });

    it("DENIES DDL to the runtime role", async () => {
      await expectSqlState(
        () => app.query("create table mail_should_fail (id uuid)"),
        SQLSTATE.insufficientPrivilege,
      );
    });

    it("DENIES the runtime role dropping a mail constraint", async () => {
      // The CHECKs must not be removable by the role the API and worker use.
      let caught: { code?: string } | undefined;
      try {
        await app.query("alter table mail_connections drop constraint mail_connections_status");
      } catch (err) {
        caught = err as { code?: string };
      }
      expect(caught).toBeDefined();
      // Postgres reports a table-ownership failure as 42501 here.
      expect(caught?.code).toBe(SQLSTATE.insufficientPrivilege);
    });
  });
});
