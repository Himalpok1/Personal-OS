import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Proof that migration 0023's constraints (Checkpoint 10.7, ADR-077) actually
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
      `memory-constraints.test.ts resolved ${name} to a connection string that does not look like a test database -- refusing to run against it`,
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

describeIf("migration 0023 constraints", () => {
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
    // FK-safe order: memories references memory_suggestions, projects and
    // canvas_courses (all set null); canvas_courses cascades from
    // canvas_connections. Only rows this file seeds are touched: the project
    // and connection rows carry a recognisable name/base URL.
    await db.query("delete from memories");
    await db.query("delete from memory_suggestions");
    await db.query("delete from memory_settings");
    await db.query("delete from projects where name like 'memory-constraints %'");
    await db.query(
      "delete from canvas_connections where canvas_base_url like '%memory-constraints%'",
    );
  });

  async function insertProject(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into projects (name) values ('memory-constraints project') returning id`,
    );
    return rows[0]!.id;
  }

  async function insertCourse(): Promise<string> {
    const { rows: connections } = await db.query<{ id: string }>(
      `insert into canvas_connections (canvas_base_url, canvas_user_id, canvas_user_name, status)
       values ($1, 1, 'Test Student', 'active') returning id`,
      [`https://memory-constraints-${Math.random().toString(36).slice(2)}.instructure.com`],
    );
    const { rows } = await db.query<{ id: string }>(
      `insert into canvas_courses (connection_id, canvas_course_id, name)
       values ($1, 1, 'memory-constraints course') returning id`,
      [connections[0]!.id],
    );
    return rows[0]!.id;
  }

  async function insertMemory(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      kind: "preference",
      statement: "I work best in the evening",
      source: "user",
      suggestion_id: null,
      project_id: null,
      canvas_course_id: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into memories (kind, statement, source, suggestion_id, project_id, canvas_course_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        row.kind,
        row.statement,
        row.source,
        row.suggestion_id,
        row.project_id,
        row.canvas_course_id,
      ],
    );
    return rows[0]!.id;
  }

  async function insertSuggestion(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      suggestion_key: `project_goal:${crypto.randomUUID()}`,
      suggestion_kind: "project_goal",
      project_id: null,
      status: "never",
      ask_again_after: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into memory_suggestions (suggestion_key, suggestion_kind, project_id, status, ask_again_after)
       values ($1, $2, $3, $4, $5) returning id`,
      [row.suggestion_key, row.suggestion_kind, row.project_id, row.status, row.ask_again_after],
    );
    return rows[0]!.id;
  }

  // -------------------------------------------------------------------
  // memories
  // -------------------------------------------------------------------

  describe("memories", () => {
    it("accepts each of the three kinds and both sources", async () => {
      for (const kind of ["preference", "goal", "fact"]) {
        await expect(insertMemory({ kind })).resolves.toBeTruthy();
      }
      const suggestionId = await insertSuggestion({ status: "accepted" });
      await expect(
        insertMemory({ source: "suggestion", suggestion_id: suggestionId }),
      ).resolves.toBeTruthy();
    });

    it("REJECTS a kind outside the closed vocabulary", async () => {
      await expectSqlState(() => insertMemory({ kind: "habit" }), SQLSTATE.checkViolation);
    });

    it("REJECTS a source outside the closed vocabulary", async () => {
      await expectSqlState(() => insertMemory({ source: "parser" }), SQLSTATE.checkViolation);
    });

    it("REJECTS a null statement, kind or source", async () => {
      await expectSqlState(() => insertMemory({ statement: null }), SQLSTATE.notNullViolation);
      await expectSqlState(() => insertMemory({ kind: null }), SQLSTATE.notNullViolation);
      await expectSqlState(() => insertMemory({ source: null }), SQLSTATE.notNullViolation);
    });

    it("REJECTS a project_id, canvas_course_id or suggestion_id that names no row", async () => {
      await expectSqlState(
        () => insertMemory({ project_id: crypto.randomUUID() }),
        SQLSTATE.foreignKeyViolation,
      );
      await expectSqlState(
        () => insertMemory({ canvas_course_id: crypto.randomUUID() }),
        SQLSTATE.foreignKeyViolation,
      );
      await expectSqlState(
        () => insertMemory({ suggestion_id: crypto.randomUUID() }),
        SQLSTATE.foreignKeyViolation,
      );
    });

    it("SETS project_id NULL when the project is deleted -- as the runtime role -- and keeps the memory", async () => {
      const projectId = await insertProject();
      const memoryId = await insertMemory({ project_id: projectId });
      await app.query("delete from projects where id = $1", [projectId]);
      const { rows } = await db.query<{ project_id: string | null; statement: string }>(
        "select project_id, statement from memories where id = $1",
        [memoryId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.project_id).toBeNull();
      expect(rows[0]!.statement).toBe("I work best in the evening");
    });

    it("SETS canvas_course_id NULL when the course goes away with its connection", async () => {
      const courseId = await insertCourse();
      const memoryId = await insertMemory({ canvas_course_id: courseId });
      await app.query(
        "delete from canvas_connections where id = (select connection_id from canvas_courses where id = $1)",
        [courseId],
      );
      const { rows } = await db.query<{ canvas_course_id: string | null }>(
        "select canvas_course_id from memories where id = $1",
        [memoryId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.canvas_course_id).toBeNull();
    });

    it("SETS suggestion_id NULL when the decision row is deleted -- the memory outlives its provenance row", async () => {
      const suggestionId = await insertSuggestion({ status: "accepted" });
      const memoryId = await insertMemory({ source: "suggestion", suggestion_id: suggestionId });
      await app.query("delete from memory_suggestions where id = $1", [suggestionId]);
      const { rows } = await db.query<{ suggestion_id: string | null; source: string }>(
        "select suggestion_id, source from memories where id = $1",
        [memoryId],
      );
      expect(rows[0]!.suggestion_id).toBeNull();
      expect(rows[0]!.source).toBe("suggestion");
    });
  });

  // -------------------------------------------------------------------
  // memory_suggestions
  // -------------------------------------------------------------------

  describe("memory_suggestions", () => {
    it("accepts each of the three statuses", async () => {
      for (const status of ["accepted", "dismissed", "never"]) {
        await expect(insertSuggestion({ status })).resolves.toBeTruthy();
      }
    });

    it("REJECTS a status outside the closed vocabulary", async () => {
      await expectSqlState(() => insertSuggestion({ status: "pending" }), SQLSTATE.checkViolation);
    });

    it("REJECTS a suggestion_kind outside the closed vocabulary -- a new trigger is a migration", async () => {
      await expectSqlState(
        () => insertSuggestion({ suggestion_kind: "evening_person" }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a duplicate suggestion_key -- one answer per key", async () => {
      await insertSuggestion({ suggestion_key: "project_goal:dupe" });
      await expectSqlState(
        () => insertSuggestion({ suggestion_key: "project_goal:dupe" }),
        SQLSTATE.uniqueViolation,
      );
    });

    it("SETS project_id NULL when the project is deleted, keeping the answer", async () => {
      const projectId = await insertProject();
      const id = await insertSuggestion({ project_id: projectId });
      await app.query("delete from projects where id = $1", [projectId]);
      const { rows } = await db.query<{ project_id: string | null; status: string }>(
        "select project_id, status from memory_suggestions where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({ project_id: null, status: "never" });
    });

    it("carries no statement column at all -- the schema cannot hold the declined text", async () => {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'memory_suggestions'
         order by column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual([
        "ask_again_after",
        "created_at",
        "decided_at",
        "id",
        "project_id",
        "status",
        "suggestion_key",
        "suggestion_kind",
        "updated_at",
      ]);
    });
  });

  // -------------------------------------------------------------------
  // memory_settings
  // -------------------------------------------------------------------

  describe("memory_settings", () => {
    it("accepts the singleton id, defaulting enabled to true", async () => {
      const { rows } = await db.query<{ enabled: boolean }>(
        "insert into memory_settings (id) values ('singleton') returning enabled",
      );
      expect(rows[0]!.enabled).toBe(true);
    });

    it("REJECTS any other id -- one switch, ever", async () => {
      await expectSqlState(
        () => db.query("insert into memory_settings (id) values ('second')"),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a second singleton row (primary key)", async () => {
      await db.query("insert into memory_settings (id) values ('singleton')");
      await expectSqlState(
        () => db.query("insert into memory_settings (id) values ('singleton')"),
        SQLSTATE.uniqueViolation,
      );
    });
  });

  // -------------------------------------------------------------------
  // Role separation
  // -------------------------------------------------------------------

  describe("role separation of duties", () => {
    it("lets the runtime role read and write every memory table without an explicit GRANT (default privileges)", async () => {
      const { rows } = await app.query<{ id: string }>(
        `insert into memories (kind, statement, source) values ('fact', 'app role', 'user') returning id`,
      );
      const id = rows[0]!.id;
      await expect(
        app.query("update memories set statement = 'edited' where id = $1", [id]),
      ).resolves.toBeTruthy();
      await expect(
        app.query(
          `insert into memory_suggestions (suggestion_key, suggestion_kind, status)
           values ('project_goal:app-role', 'project_goal', 'never')`,
        ),
      ).resolves.toBeTruthy();
      await expect(
        app.query("insert into memory_settings (id, enabled) values ('singleton', false)"),
      ).resolves.toBeTruthy();
      await expect(app.query("select 1 from memory_settings")).resolves.toBeTruthy();
      await expect(app.query("delete from memories where id = $1", [id])).resolves.toBeTruthy();
    });

    it("DENIES the runtime role TRUNCATE -- delete-all must be a DELETE", async () => {
      await expectSqlState(
        () => app.query("truncate table memories"),
        SQLSTATE.insufficientPrivilege,
      );
    });

    it("DENIES the runtime role dropping a memory constraint", async () => {
      let caught: { code?: string } | undefined;
      try {
        await app.query("alter table memories drop constraint memories_kind");
      } catch (err) {
        caught = err as { code?: string };
      }
      expect(caught).toBeDefined();
      expect(caught?.code).toBe(SQLSTATE.insufficientPrivilege);
    });
  });
});
