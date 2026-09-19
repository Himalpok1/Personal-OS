import path from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Proof that migration 0025's constraints (Checkpoint 10.9, ADR-081) actually
// BITE against a real Postgres, rather than merely being declared in Drizzle
// and in SQL. Follows action-constraints.test.ts exactly.

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const migratorUrl = process.env["TEST_MIGRATIONS_DATABASE_URL"];
const appUrl = process.env["TEST_DATABASE_URL"];

for (const [name, url] of [
  ["TEST_MIGRATIONS_DATABASE_URL", migratorUrl],
  ["TEST_DATABASE_URL", appUrl],
] as const) {
  if (url && !/test/i.test(url)) {
    throw new Error(
      `agent-constraints.test.ts resolved ${name} to a connection string that does not look like a test database -- refusing to run against it`,
    );
  }
}

const SQLSTATE = {
  checkViolation: "23514",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  notNullViolation: "23502",
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

describeIf("migration 0025 constraints", () => {
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
    await db.query("delete from agent_tool_calls");
    await db.query("delete from action_requests");
    await db.query("delete from agents");
    await db.query("delete from permission_grants");
  });

  async function insertAgent(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      name: "curl-agent",
      trust_level: "read",
      token_hash: crypto.randomUUID(),
      disclosure_version: "2026-09-18",
      revoked_at: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into agents (name, trust_level, token_hash, disclosure_version, revoked_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [row.name, row.trust_level, row.token_hash, row.disclosure_version, row.revoked_at],
    );
    return rows[0]!.id;
  }

  async function insertToolCall(
    agentId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const row = {
      correlation_id: crypto.randomUUID(),
      tool_name: "get_today_context",
      status: "completed",
      error_class: null,
      chars_returned: 120,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into agent_tool_calls (agent_id, correlation_id, tool_name, status, error_class, chars_returned)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [agentId, row.correlation_id, row.tool_name, row.status, row.error_class, row.chars_returned],
    );
    return rows[0]!.id;
  }

  async function insertRequest(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      principal: "app",
      source: "manual",
      agent_id: null,
      correlation_id: null,
      ...overrides,
    };
    const { rows } = await db.query<{ id: string }>(
      `insert into action_requests (action_id, principal, source, input, input_summary, expires_at, agent_id, correlation_id)
       values ('create_task', $1, $2, '{}', 'Create task', now() + interval '1 day', $3, $4) returning id`,
      [row.principal, row.source, row.agent_id, row.correlation_id],
    );
    return rows[0]!.id;
  }

  describe("agents", () => {
    it("REJECTS a trust level outside none|read|propose -- there is no operator member", async () => {
      for (const level of ["none", "read", "propose"]) {
        await expect(insertAgent({ trust_level: level })).resolves.toBeTruthy();
      }
      await expectSqlState(() => insertAgent({ trust_level: "operator" }), SQLSTATE.checkViolation);
      await expectSqlState(() => insertAgent({ trust_level: "admin" }), SQLSTATE.checkViolation);
    });

    it("defaults trust_level to none when omitted", async () => {
      const { rows } = await db.query<{ trust_level: string }>(
        `insert into agents (name, token_hash, disclosure_version) values ('a', $1, 'v') returning trust_level`,
        [crypto.randomUUID()],
      );
      expect(rows[0]!.trust_level).toBe("none");
    });

    it("keeps the token hash unique and non-null; the name bounded at 60", async () => {
      const hash = crypto.randomUUID();
      await insertAgent({ token_hash: hash });
      await expectSqlState(() => insertAgent({ token_hash: hash }), SQLSTATE.uniqueViolation);
      await expectSqlState(() => insertAgent({ token_hash: null }), SQLSTATE.notNullViolation);
      await expectSqlState(() => insertAgent({ name: "" }), SQLSTATE.checkViolation);
      await expectSqlState(() => insertAgent({ name: "x".repeat(61) }), SQLSTATE.checkViolation);
      await expect(insertAgent({ name: "x".repeat(60) })).resolves.toBeTruthy();
    });

    it("revocation is a timestamp, and a revoked row keeps its FK children", async () => {
      const agent = await insertAgent();
      await insertToolCall(agent);
      await db.query("update agents set revoked_at = now() where id = $1", [agent]);
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from agent_tool_calls where agent_id = $1",
        [agent],
      );
      expect(rows[0]!.n).toBe(1);
      // A DELETE of the agent is refused while children exist (no cascade, no set null).
      await expectSqlState(
        () => db.query("delete from agents where id = $1", [agent]),
        SQLSTATE.foreignKeyViolation,
      );
    });
  });

  describe("agent_tool_calls", () => {
    it("accepts exactly the six read tool names and rejects a seventh", async () => {
      const agent = await insertAgent();
      for (const tool of [
        "search_personal_items",
        "get_item_context",
        "get_today_context",
        "get_calendar_context",
        "get_task_context",
        "get_academic_context",
      ]) {
        await expect(insertToolCall(agent, { tool_name: tool })).resolves.toBeTruthy();
      }
      await expectSqlState(
        () => insertToolCall(agent, { tool_name: "get_memory" }),
        SQLSTATE.checkViolation,
      );
      await expectSqlState(
        () => insertToolCall(agent, { tool_name: "create_task" }),
        SQLSTATE.checkViolation,
      );
    });

    it("pairs status and error_class: completed ⟺ no error class", async () => {
      const agent = await insertAgent();
      await expect(
        insertToolCall(agent, { status: "refused", error_class: "permission_not_granted" }),
      ).resolves.toBeTruthy();
      await expect(
        insertToolCall(agent, { status: "failed", error_class: "tool_failed" }),
      ).resolves.toBeTruthy();
      await expectSqlState(
        () => insertToolCall(agent, { status: "refused", error_class: null }),
        SQLSTATE.checkViolation,
      );
      await expectSqlState(
        () => insertToolCall(agent, { status: "completed", error_class: "tool_failed" }),
        SQLSTATE.checkViolation,
      );
      await expectSqlState(
        () => insertToolCall(agent, { status: "pending", error_class: null }),
        SQLSTATE.checkViolation,
      );
    });

    it("REJECTS a negative char count and an unknown agent", async () => {
      const agent = await insertAgent();
      await expectSqlState(
        () => insertToolCall(agent, { chars_returned: -1 }),
        SQLSTATE.checkViolation,
      );
      await expectSqlState(() => insertToolCall(crypto.randomUUID()), SQLSTATE.foreignKeyViolation);
    });
  });

  describe("action_requests attribution", () => {
    it("accepts the new `agent` source and pairs principal=agent with agent_id both ways", async () => {
      const agent = await insertAgent({ trust_level: "propose" });
      await expect(
        insertRequest({
          principal: "agent",
          source: "agent",
          agent_id: agent,
          correlation_id: crypto.randomUUID(),
        }),
      ).resolves.toBeTruthy();
      // principal=agent without an agent id
      await expectSqlState(
        () => insertRequest({ principal: "agent", source: "agent" }),
        SQLSTATE.checkViolation,
      );
      // an agent id on an app row
      await expectSqlState(
        () => insertRequest({ principal: "app", source: "manual", agent_id: agent }),
        SQLSTATE.checkViolation,
      );
      // an unknown agent
      await expectSqlState(
        () => insertRequest({ principal: "agent", source: "agent", agent_id: crypto.randomUUID() }),
        SQLSTATE.foreignKeyViolation,
      );
    });

    it("still rejects a source outside the five members", async () => {
      await expectSqlState(() => insertRequest({ source: "model" }), SQLSTATE.checkViolation);
      for (const source of ["focus_now", "briefing", "academic", "manual"]) {
        await expect(insertRequest({ source })).resolves.toBeTruthy();
      }
    });

    it("the runtime role can insert, update and delete every 0025 table through default privileges (no GRANT in the migration)", async () => {
      const agent = await app.query<{ id: string }>(
        `insert into agents (name, token_hash, disclosure_version) values ('a', $1, 'v') returning id`,
        [crypto.randomUUID()],
      );
      const call = await app.query<{ id: string }>(
        `insert into agent_tool_calls (agent_id, correlation_id, tool_name, status) values ($1, $2, 'get_today_context', 'completed') returning id`,
        [agent.rows[0]!.id, crypto.randomUUID()],
      );
      const request = await app.query<{ id: string }>(
        `insert into action_requests (action_id, principal, source, input, input_summary, expires_at, agent_id)
         values ('create_task', 'agent', 'agent', '{}', 'x', now(), $1) returning id`,
        [agent.rows[0]!.id],
      );
      await app.query(
        "update agents set trust_level = 'propose', revoked_at = now() where id = $1",
        [agent.rows[0]!.id],
      );
      await app.query("delete from action_requests where id = $1", [request.rows[0]!.id]);
      await app.query("delete from agent_tool_calls where id = $1", [call.rows[0]!.id]);
      await app.query("delete from agents where id = $1", [agent.rows[0]!.id]);
    });
  });
});
