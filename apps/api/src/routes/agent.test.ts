import { hashAgentToken } from "@personal-os/core";
import { setLogSink } from "@personal-os/core/logging/logger";
import {
  actionRequests,
  agentToolCalls,
  agents,
  aiTaskRoutes,
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  events,
  inboxItems,
  notes,
  permissionGrants,
  tasks,
} from "@personal-os/db";
import {
  ACTION_PERMISSION_DISCLOSURE_VERSION,
  AGENT_TOKEN_PREFIX,
  AGENT_TOOL_CALLS_PER_MINUTE,
  ActionListResponseSchema,
  ActionRequestItemSchema,
  AgentActionItemSchema,
  AgentActionListResponseSchema,
  AgentManifestSchema,
  AgentPermissionsResponseSchema,
  AgentRefusalSchema,
  AgentToolCallResponseSchema,
  GetAcademicContextOutputSchema,
  GetCalendarContextOutputSchema,
  GetItemContextOutputSchema,
  GetTaskContextOutputSchema,
  GetTodayContextOutputSchema,
  PermissionsResponseSchema,
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
  READ_TOOL_NAMES,
  SearchPersonalItemsOutputSchema,
  type AgentActionItem,
  type AgentRefusal,
  type AgentToolCallResponse,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentHeaders,
  grantAgentPermission,
  pairTestDevice,
  registerTestAgent,
} from "../test/agents.test-support.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.9 (ADR-081) -- the AGENT-facing half of the gateway through
// the real routes: the manifest, the six read tools behind trust /
// permission / budget / rate, proposals through the Action Framework with
// agent attribution, own-rows-only isolation, cross-principal grants, auth
// crossing, and the wire freeze for the deployed client.

const TZ = "America/Chicago";
/** A schema-valid input per tool, so a refusal test proves the GATE refused, not the input parser. */
const VALID_INPUTS: Record<(typeof READ_TOOL_NAMES)[number], Record<string, unknown>> = {
  search_personal_items: { q: "chapter" },
  get_item_context: { type: "note", id: "00000000-0000-4000-8000-000000000000" },
  get_today_context: { tz: TZ },
  get_calendar_context: { tz: TZ, from: "2026-09-17", to: "2026-09-19" },
  get_task_context: { id: "00000000-0000-4000-8000-000000000000" },
  get_academic_context: { tz: TZ },
};
const NOTE_BODY = "Zanzibar body: the full text of the note only items.read may read";

async function clearCanvas(app: FastifyInstance): Promise<void> {
  await app.db.delete(canvasConnections);
}

async function seedNote(app: FastifyInstance): Promise<string> {
  const [row] = await app.db
    .insert(notes)
    .values({ title: "Reading list", body: NOTE_BODY })
    .returning({ id: notes.id });
  return row!.id;
}

async function seedTask(
  app: FastifyInstance,
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<string> {
  const [row] = await app.db
    .insert(tasks)
    .values({
      title: "Read chapter 4",
      status: "active",
      timezone: TZ,
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      ...overrides,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

async function seedAcademic(app: FastifyInstance) {
  const [connection] = await app.db
    .insert(canvasConnections)
    .values({
      canvasBaseUrl: `https://${crypto.randomUUID()}.instructure.com`,
      canvasUserId: 1,
      canvasUserName: "Test Student",
      status: "active",
    })
    .returning();
  const [course] = await app.db
    .insert(canvasCourses)
    .values({
      connectionId: connection!.id,
      canvasCourseId: 4315,
      name: "Advanced Web Dev",
      courseCode: "INSY-4315",
      htmlUrl: `${connection!.canvasBaseUrl}/courses/4315`,
    })
    .returning();
  const DAY = 24 * 60 * 60 * 1000;
  const [overdue] = await app.db
    .insert(canvasAssignments)
    .values({
      connectionId: connection!.id,
      courseId: course!.id,
      canvasAssignmentId: 99001,
      title: "Project 2 SENTINEL-TITLE",
      dueAt: new Date(Date.now() - DAY),
      pointsPossible: 100,
      submissionState: "unsubmitted",
      submissionMissing: true,
      htmlUrl: `${connection!.canvasBaseUrl}/courses/4315/assignments/99001`,
      score: null,
      grade: null,
    })
    .returning();
  const [upcoming] = await app.db
    .insert(canvasAssignments)
    .values({
      connectionId: connection!.id,
      courseId: course!.id,
      canvasAssignmentId: 99002,
      title: "Quiz 3",
      dueAt: new Date(Date.now() + 2 * DAY),
      pointsPossible: 20,
      submissionState: "unsubmitted",
      htmlUrl: `${connection!.canvasBaseUrl}/courses/4315/assignments/99002`,
      score: null,
      grade: null,
    })
    .returning();
  return { connection: connection!, course: course!, overdue: overdue!, upcoming: upcoming! };
}

async function callTool(
  app: FastifyInstance,
  token: string,
  tool: string,
  input: Record<string, unknown>,
  correlationId = crypto.randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/agent/tools/${tool}`,
    headers: agentHeaders(token),
    payload: { input, correlation_id: correlationId },
  });
}

async function auditRows(app: FastifyInstance, agentId: string) {
  return app.db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.agentId, agentId))
    .orderBy(agentToolCalls.calledAt, agentToolCalls.id);
}

function proposalBody(overrides: Record<string, unknown> = {}) {
  return {
    action_id: "create_task",
    input: { title: "Read chapter 5", timezone: TZ },
    reason: "The syllabus lists chapter 5 for Thursday",
    correlation_id: crypto.randomUUID(),
    ...overrides,
  };
}

async function propose(
  app: FastifyInstance,
  token: string,
  body: Record<string, unknown>,
  expectedStatus = 201,
): Promise<AgentActionItem> {
  const response = await app.inject({
    method: "POST",
    url: "/agent/actions",
    headers: agentHeaders(token),
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(expectedStatus);
  return AgentActionItemSchema.parse(response.json());
}

describe("the agent gateway (/agent/*)", () => {
  let app: FastifyInstance;
  let deviceToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    await clearCanvas(app);
    deviceToken = await pairTestDevice(app);
  });

  // ---- registration and the token ------------------------------------------

  describe("the token", () => {
    it("is returned once with the posa_ prefix, stored only as its sha256, and never returned by any GET", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
      const [row] = await app.db.select().from(agents).where(eq(agents.id, agent.id));
      expect(row?.tokenHash).toBe(hashAgentToken(token));
      expect(row?.tokenHash).not.toContain(token);

      const list = await app.inject({
        method: "GET",
        url: "/agents",
        headers: agentHeaders(deviceToken),
      });
      const one = await app.inject({
        method: "GET",
        url: `/agents/${agent.id}`,
        headers: agentHeaders(deviceToken),
      });
      const manifest = await app.inject({
        method: "GET",
        url: "/agent/manifest",
        headers: agentHeaders(token),
      });
      for (const response of [list, one, manifest]) {
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain(token);
        expect(response.body).not.toContain("token");
      }
    });
  });

  // ---- revocation ------------------------------------------------------------

  describe("a revoked agent", () => {
    it("is 401 agent_revoked on every /agent/* route, cannot be edited (409), and revoke is idempotent", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, {
        trust_level: "propose",
      });
      await grantAgentPermission(app, deviceToken, "context.read");
      const first = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/revoke`,
        headers: agentHeaders(deviceToken),
      });
      expect(first.statusCode).toBe(200);
      const revokedAt = first.json<{ revoked_at: string }>().revoked_at;
      expect(revokedAt).not.toBeNull();

      const again = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/revoke`,
        headers: agentHeaders(deviceToken),
      });
      expect(again.statusCode).toBe(200);
      expect(again.json<{ revoked_at: string }>().revoked_at).toBe(revokedAt);

      const routes = [
        { method: "GET" as const, url: "/agent/manifest" },
        {
          method: "POST" as const,
          url: "/agent/tools/get_today_context",
          payload: { input: { tz: TZ }, correlation_id: crypto.randomUUID() },
        },
        { method: "POST" as const, url: "/agent/actions", payload: proposalBody() },
        { method: "GET" as const, url: "/agent/actions" },
        { method: "GET" as const, url: `/agent/actions/${crypto.randomUUID()}` },
        { method: "POST" as const, url: `/agent/actions/${crypto.randomUUID()}/cancel` },
      ];
      for (const route of routes) {
        const response = await app.inject({ ...route, headers: agentHeaders(token) });
        expect(response.statusCode, route.url).toBe(401);
        expect(response.json<ErrorBody>().error).toBe("agent_revoked");
      }
      expect(await auditRows(app, agent.id)).toHaveLength(0);

      const patch = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        headers: agentHeaders(deviceToken),
        payload: { trust_level: "read" },
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json<ErrorBody>().error).toBe("agent_revoked");
    });
  });

  // ---- the manifest ------------------------------------------------------------

  describe("GET /agent/manifest", () => {
    it("lists six read tools with JSON schemas, six actions requiring approval, and the agent's (all-off) grants", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      const response = await app.inject({
        method: "GET",
        url: "/agent/manifest",
        headers: agentHeaders(token),
      });
      expect(response.statusCode).toBe(200);
      const manifest = AgentManifestSchema.parse(response.json());
      expect(manifest.agent).toEqual({ id: agent.id, name: "Test agent", trust_level: "read" });
      expect(manifest.validation).toBe("server-side");
      expect(manifest.tools.map((tool) => tool.tool_id)).toEqual([...READ_TOOL_NAMES]);
      for (const tool of manifest.tools) {
        expect(tool.classification).toBe("read");
        expect(tool.audited).toBe(true);
        expect(tool.input_schema["type"]).toBe("object");
        expect(tool.output_schema["type"]).toBe("object");
      }
      expect(manifest.actions).toHaveLength(6);
      for (const action of manifest.actions) {
        expect(action.requires_approval).toBe(true);
        expect(action.audited).toBe(true);
        expect(action.input_schema["type"]).toBe("object");
      }
      expect(manifest.grants).toHaveLength(5);
      for (const grant of manifest.grants) {
        expect(grant.principal).toBe("agent");
        expect(grant.granted).toBe(false);
      }
      expect(manifest.budgets.calls_per_correlation).toBe(READ_TOOL_MAX_CALLS_PER_REQUEST);
    });

    it("404s tool_unknown for a tool the manifest does not list", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      const response = await callTool(app, token, "delete_everything", {});
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>().error).toBe("tool_unknown");
    });
  });

  // ---- trust, permission, and the today tool ----------------------------------

  describe("trust and permission gates", () => {
    it("a none agent is 403 trust_insufficient on every tool, each refusal audited and never charged", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "none" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const correlation = crypto.randomUUID();
      for (const tool of READ_TOOL_NAMES) {
        const response = await callTool(app, token, tool, VALID_INPUTS[tool], correlation);
        expect(response.statusCode, tool).toBe(403);
        const body = AgentRefusalSchema.parse(response.json());
        expect(body.error).toBe("agent_tool_refused");
        expect(body.error_class).toBe("trust_insufficient");
        expect(body.budget?.calls_used).toBe(0);
      }
      const rows = await auditRows(app, agent.id);
      expect(rows).toHaveLength(READ_TOOL_NAMES.length);
      for (const row of rows) {
        expect(row.status).toBe("refused");
        expect(row.errorClass).toBe("trust_insufficient");
        expect(row.charsReturned).toBe(0);
      }
    });

    it("a read agent without context.read is 403 permission_not_granted and audited", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      const response = await callTool(app, token, "get_today_context", { tz: TZ });
      expect(response.statusCode).toBe(403);
      expect(AgentRefusalSchema.parse(response.json()).error_class).toBe("permission_not_granted");
      const [row] = await auditRows(app, agent.id);
      expect(row).toMatchObject({
        status: "refused",
        errorClass: "permission_not_granted",
        toolName: "get_today_context",
      });
    });

    it("with context.read, get_today_context completes WITHOUT any ai_task_routes row, parses, and audits the exact serialized length", async () => {
      expect(await app.db.select().from(aiTaskRoutes)).toHaveLength(0);
      await seedTask(app);
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const correlation = crypto.randomUUID();
      const response = await callTool(app, token, "get_today_context", { tz: TZ }, correlation);
      expect(response.statusCode, response.body).toBe(200);
      const body = AgentToolCallResponseSchema.parse(response.json());
      expect(body.tool_name).toBe("get_today_context");
      expect(body.correlation_id).toBe(correlation);
      const output = GetTodayContextOutputSchema.parse(body.output);
      expect(output.tz).toBe(TZ);
      expect(output.summary.overdue_total).toBe(1);
      expect(output.overdue.items[0]?.title).toBe("Read chapter 4");

      const [row] = await auditRows(app, agent.id);
      expect(row?.status).toBe("completed");
      expect(row?.errorClass).toBeNull();
      expect(row?.charsReturned).toBe(JSON.stringify(body.output).length);
      expect(row?.correlationId).toBe(correlation);
      expect(row?.durationMs).toBeGreaterThanOrEqual(0);
      expect(body.budget).toEqual({
        correlation_id: correlation,
        calls_used: 1,
        calls_max: READ_TOOL_MAX_CALLS_PER_REQUEST,
        chars_used: row?.charsReturned,
        chars_max: READ_TOOL_MAX_CHARS_PER_REQUEST,
      });
      expect(await app.db.select().from(aiTaskRoutes)).toHaveLength(0);
    });

    it("a malformed input is 400 input_invalid, audited, and never echoes the schema issues", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const response = await callTool(app, token, "get_today_context", { tz: "Mars/Olympus" });
      expect(response.statusCode).toBe(400);
      const body = response.json<AgentRefusal & { issues?: unknown }>();
      expect(body.error_class).toBe("input_invalid");
      expect(body.issues).toBeUndefined();
      expect(response.body).not.toContain("Mars");
      const [row] = await auditRows(app, agent.id);
      expect(row).toMatchObject({ status: "refused", errorClass: "input_invalid" });
    });
  });

  // ---- budgets --------------------------------------------------------------------

  describe("budgets", () => {
    it("admission is atomic: twenty concurrent calls on one correlation_id yield exactly six 200s and fourteen 429s (adversarial review, finding A)", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const correlation = crypto.randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          callTool(app, token, "get_today_context", { tz: TZ }, correlation),
        ),
      );
      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes.filter((c) => c === 200)).toHaveLength(READ_TOOL_MAX_CALLS_PER_REQUEST);
      expect(codes.filter((c) => c === 429)).toHaveLength(20 - READ_TOOL_MAX_CALLS_PER_REQUEST);
      for (const r of responses.filter((r) => r.statusCode === 429)) {
        expect(AgentRefusalSchema.parse(r.json()).error_class).toBe("budget_calls_exceeded");
      }
      const rows = await auditRows(app, agent.id);
      expect(rows.filter((r) => r.status === "completed")).toHaveLength(
        READ_TOOL_MAX_CALLS_PER_REQUEST,
      );
      expect(rows.filter((r) => r.status === "refused")).toHaveLength(
        20 - READ_TOOL_MAX_CALLS_PER_REQUEST,
      );
    });

    it("the rate limit is atomic too: 100 concurrent calls across fresh correlations never exceed 60 in the window", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const responses = await Promise.all(
        Array.from({ length: 100 }, () => callTool(app, token, "get_today_context", { tz: TZ })),
      );
      const ok = responses.filter((r) => r.statusCode === 200).length;
      const limited = responses.filter((r) => r.statusCode === 429);
      expect(ok).toBe(AGENT_TOOL_CALLS_PER_MINUTE);
      expect(limited).toHaveLength(100 - AGENT_TOOL_CALLS_PER_MINUTE);
      for (const r of limited) {
        expect(AgentRefusalSchema.parse(r.json()).error_class).toBe("rate_limited");
      }
    });

    it("the budget is keyed on (agent, correlation): another agent naming the same correlation id starts from zero (adversarial review, R2)", async () => {
      const a = await registerTestAgent(app, deviceToken, { name: "A", trust_level: "read" });
      const b = await registerTestAgent(app, deviceToken, { name: "B", trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const shared = crypto.randomUUID();
      for (let i = 0; i < READ_TOOL_MAX_CALLS_PER_REQUEST; i += 1) {
        expect(
          (await callTool(app, a.token, "get_today_context", { tz: TZ }, shared)).statusCode,
        ).toBe(200);
      }
      expect(
        (await callTool(app, a.token, "get_today_context", { tz: TZ }, shared)).statusCode,
      ).toBe(429);
      const first = await callTool(app, b.token, "get_today_context", { tz: TZ }, shared);
      expect(first.statusCode).toBe(200);
      expect(first.json<AgentToolCallResponse>().budget.calls_used).toBe(1);
    });

    it("the seventh completed call on one correlation_id is 429 budget_calls_exceeded; an interleaved refusal does not count", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const correlation = crypto.randomUUID();
      for (let i = 0; i < READ_TOOL_MAX_CALLS_PER_REQUEST; i += 1) {
        if (i === 2) {
          // A refusal in the middle: items.read is not granted.
          const refused = await callTool(
            app,
            token,
            "get_item_context",
            { type: "note", id: crypto.randomUUID() },
            correlation,
          );
          expect(refused.statusCode).toBe(403);
        }
        const response = await callTool(app, token, "get_today_context", { tz: TZ }, correlation);
        expect(response.statusCode, `call ${i + 1}`).toBe(200);
        expect(response.json<AgentToolCallResponse>().budget.calls_used).toBe(i + 1);
      }
      const seventh = await callTool(app, token, "get_today_context", { tz: TZ }, correlation);
      expect(seventh.statusCode).toBe(429);
      const body = AgentRefusalSchema.parse(seventh.json());
      expect(body.error_class).toBe("budget_calls_exceeded");
      expect(body.budget?.calls_used).toBe(READ_TOOL_MAX_CALLS_PER_REQUEST);

      // A fresh correlation is a fresh budget.
      const fresh = await callTool(app, token, "get_today_context", { tz: TZ });
      expect(fresh.statusCode).toBe(200);

      const rows = await auditRows(app, agent.id);
      expect(rows.filter((r) => r.status === "refused")).toHaveLength(2);
      expect(rows.filter((r) => r.status === "completed")).toHaveLength(
        READ_TOOL_MAX_CALLS_PER_REQUEST + 1,
      );
    });

    it("cumulative chars at or over READ_TOOL_MAX_CHARS_PER_REQUEST is 429 budget_chars_exceeded", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const correlation = crypto.randomUUID();
      // One real call establishes the accounting the budget reads from...
      const first = await callTool(app, token, "get_today_context", { tz: TZ }, correlation);
      expect(first.statusCode).toBe(200);
      const spent = first.json<AgentToolCallResponse>().budget.chars_used;
      expect(spent).toBeGreaterThan(0);
      // ... and one direct audit row (a completed call that returned the
      // rest of the budget) pushes the correlation to the ceiling.
      await app.db.insert(agentToolCalls).values({
        agentId: agent.id,
        correlationId: correlation,
        toolName: "search_personal_items",
        status: "completed",
        errorClass: null,
        charsReturned: READ_TOOL_MAX_CHARS_PER_REQUEST - spent,
        durationMs: 1,
        calledAt: new Date(),
      });
      const response = await callTool(app, token, "get_today_context", { tz: TZ }, correlation);
      expect(response.statusCode).toBe(429);
      const body = AgentRefusalSchema.parse(response.json());
      expect(body.error_class).toBe("budget_chars_exceeded");
      expect(body.budget?.chars_used).toBe(READ_TOOL_MAX_CHARS_PER_REQUEST);
    });

    it("the 61st call inside a minute is 429 rate_limited, whatever the correlation", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const now = new Date();
      await app.db.insert(agentToolCalls).values(
        Array.from({ length: AGENT_TOOL_CALLS_PER_MINUTE }, (_, i) => ({
          agentId: agent.id,
          correlationId: crypto.randomUUID(),
          toolName: "get_today_context",
          status: i % 2 === 0 ? "completed" : "refused",
          errorClass: i % 2 === 0 ? null : "permission_not_granted",
          charsReturned: 0,
          durationMs: 1,
          calledAt: new Date(now.getTime() - 30_000),
        })),
      );
      const response = await callTool(app, token, "get_today_context", { tz: TZ });
      expect(response.statusCode).toBe(429);
      expect(AgentRefusalSchema.parse(response.json()).error_class).toBe("rate_limited");
    });
  });

  // ---- the other tools ------------------------------------------------------------

  describe("get_item_context", () => {
    it("refuses a mail or capture ref as input_invalid even with items.read (adversarial review, finding B)", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "items.read");
      const [capture] = await app.db
        .insert(inboxItems)
        .values({
          clientUuid: crypto.randomUUID(),
          rawText: "Zebrafish capture with the card ending 4242",
          source: "web",
          capturedAt: new Date(),
          timezone: TZ,
          status: "pending",
        })
        .returning({ id: inboxItems.id });
      for (const ref of [
        { type: "inbox_item", id: capture!.id },
        { type: "mail_message", id: crypto.randomUUID() },
      ]) {
        const response = await callTool(app, token, "get_item_context", ref);
        expect(response.statusCode, ref.type).toBe(400);
        expect(AgentRefusalSchema.parse(response.json()).error_class).toBe("input_invalid");
        expect(response.body).not.toContain("4242");
      }
    });

    it("needs items.read (403 with only context.read); with it a note's body is returned; an unknown ref is 404 target_not_found audited failed", async () => {
      const noteId = await seedNote(app);
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const refused = await callTool(app, token, "get_item_context", { type: "note", id: noteId });
      expect(refused.statusCode).toBe(403);
      expect(AgentRefusalSchema.parse(refused.json()).error_class).toBe("permission_not_granted");

      await grantAgentPermission(app, deviceToken, "items.read");
      const ok = await callTool(app, token, "get_item_context", { type: "note", id: noteId });
      expect(ok.statusCode, ok.body).toBe(200);
      const output = GetItemContextOutputSchema.parse(
        AgentToolCallResponseSchema.parse(ok.json()).output,
      );
      expect(output.body).toBe(NOTE_BODY);
      expect(output.citations).toEqual([{ type: "note", id: noteId }]);

      const missing = await callTool(app, token, "get_item_context", {
        type: "note",
        id: crypto.randomUUID(),
      });
      expect(missing.statusCode).toBe(404);
      expect(AgentRefusalSchema.parse(missing.json()).error_class).toBe("target_not_found");
      const rows = await auditRows(app, agent.id);
      expect(rows.map((r) => [r.status, r.errorClass])).toEqual([
        ["refused", "permission_not_granted"],
        ["completed", null],
        ["failed", "target_not_found"],
      ]);
    });
  });

  describe("search_personal_items", () => {
    it("never returns mail or a capture, and an explicit request for either type is input_invalid (adversarial review, finding B)", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      await app.db.insert(inboxItems).values({
        clientUuid: crypto.randomUUID(),
        rawText: "Zebrafish capture with the card ending 4242",
        source: "web",
        capturedAt: new Date(),
        timezone: TZ,
        status: "pending",
      });
      await seedNote(app);
      const implicit = await callTool(app, token, "search_personal_items", { q: "zebrafish" });
      expect(implicit.statusCode).toBe(200);
      const output = SearchPersonalItemsOutputSchema.parse(
        implicit.json<AgentToolCallResponse>().output,
      );
      expect(output.results.map((r) => r.type)).not.toContain("inbox_item");
      expect(JSON.stringify(output)).not.toContain("4242");
      for (const type of ["mail_message", "inbox_item"]) {
        const explicit = await callTool(app, token, "search_personal_items", {
          q: "zebrafish",
          types: [type],
        });
        expect(explicit.statusCode, type).toBe(400);
        expect(AgentRefusalSchema.parse(explicit.json()).error_class).toBe("input_invalid");
      }
      const rows = await auditRows(app, agent.id);
      expect(rows.filter((r) => r.errorClass === "input_invalid")).toHaveLength(2);
    });

    it("returns ids, titles and previews under context.read and parses through its output schema", async () => {
      await seedNote(app); // does not match the query; proves a body never rides along
      const taskId = await seedTask(app, { title: "Quokka reading" });
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const response = await callTool(app, token, "search_personal_items", {
        q: "quokka",
        limit: 3,
      });
      expect(response.statusCode, response.body).toBe(200);
      const output = SearchPersonalItemsOutputSchema.parse(
        AgentToolCallResponseSchema.parse(response.json()).output,
      );
      expect(output.results.map((r) => r.id)).toEqual([taskId]);
      expect(output.citations).toEqual([{ type: "task", id: taskId }]);
      // A note body never rides on a search result.
      expect(response.body).not.toContain(NOTE_BODY);
    });
  });

  describe("get_task_context and get_calendar_context", () => {
    it("get_task_context returns a body-free task by id and 404s an unknown id", async () => {
      const taskId = await seedTask(app, { body: "Zanzibar task body" });
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const response = await callTool(app, token, "get_task_context", { id: taskId });
      expect(response.statusCode, response.body).toBe(200);
      const output = GetTaskContextOutputSchema.parse(
        AgentToolCallResponseSchema.parse(response.json()).output,
      );
      expect(output.id).toBe(taskId);
      expect(output.title).toBe("Read chapter 4");
      expect(response.body).not.toContain("Zanzibar task body");

      const missing = await callTool(app, token, "get_task_context", { id: crypto.randomUUID() });
      expect(missing.statusCode).toBe(404);
      expect(AgentRefusalSchema.parse(missing.json()).error_class).toBe("target_not_found");
    });

    it("get_calendar_context returns the events in a local-date window", async () => {
      const [event] = await app.db
        .insert(events)
        .values({
          title: "Lab meeting",
          description: "Zanzibar description",
          timezone: TZ,
          startsAt: new Date("2026-09-18T20:00:00-05:00"),
          endsAt: new Date("2026-09-18T21:00:00-05:00"),
          origin: "local",
        })
        .returning({ id: events.id });
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      const response = await callTool(app, token, "get_calendar_context", {
        tz: TZ,
        from: "2026-09-17",
        to: "2026-09-19",
      });
      expect(response.statusCode, response.body).toBe(200);
      const output = GetCalendarContextOutputSchema.parse(
        AgentToolCallResponseSchema.parse(response.json()).output,
      );
      expect(output.items.map((item) => item.id)).toContain(event!.id);
      expect(response.body).not.toContain("Zanzibar description");
    });
  });

  describe("get_academic_context", () => {
    it("is 403 permission_not_granted until academic.read is granted; with it the projection parses, is third_party, and carries no link, base url or grade", async () => {
      const seeded = await seedAcademic(app);
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "context.read");
      await grantAgentPermission(app, deviceToken, "items.read");
      const refused = await callTool(app, token, "get_academic_context", { tz: TZ });
      expect(refused.statusCode).toBe(403);
      expect(AgentRefusalSchema.parse(refused.json()).error_class).toBe("permission_not_granted");

      await grantAgentPermission(app, deviceToken, "academic.read");
      const response = await callTool(app, token, "get_academic_context", { tz: TZ });
      expect(response.statusCode, response.body).toBe(200);
      const output = GetAcademicContextOutputSchema.parse(
        AgentToolCallResponseSchema.parse(response.json()).output,
      );
      expect(output.configured).toBe(true);
      expect(output.assignments.provenance).toBe("third_party");
      expect(output.summary.overdue_total).toBe(1);
      expect(output.courses).toEqual([
        { id: seeded.course.id, name: "Advanced Web Dev", code: "INSY-4315" },
      ]);
      const overdue = output.assignments.items.find((item) => item.id === seeded.overdue.id);
      expect(overdue).toMatchObject({
        course_id: seeded.course.id,
        title: "Project 2 SENTINEL-TITLE",
        points_possible: 100,
        submission_status: "unsubmitted",
        missing: true,
        urgency: "critical",
      });
      expect(overdue?.priority_reasons).toContain("overdue");
      expect(output.assignments.items.map((item) => item.id)).toContain(seeded.upcoming.id);
      expect(output.assignments.total).toBe(2);

      const raw = JSON.stringify(response.json());
      for (const forbidden of [
        "html_url",
        "source_base_url",
        "instructure",
        '"grade"',
        "/courses/",
      ]) {
        expect(raw, forbidden).not.toContain(forbidden);
      }
    });
  });

  // ---- proposals ---------------------------------------------------------------------

  describe("POST /agent/actions", () => {
    it("a target-bearing action needs context.read as well as its write permission -- a bare id cannot read a title through input_summary (adversarial review, R11)", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const taskId = await seedTask(app, { title: "SECRET: call the oncologist" });
      const refused = await app.inject({
        method: "POST",
        url: "/agent/actions",
        headers: agentHeaders(token),
        payload: proposalBody({ action_id: "complete_task", input: { task_id: taskId } }),
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ error_class: string }>().error_class).toBe("permission_not_granted");
      expect(refused.body).not.toContain("oncologist");
      // A create action names no existing row and needs only its write grant.
      await propose(app, token, proposalBody());
      // With context.read the same proposal is admitted.
      await grantAgentPermission(app, deviceToken, "context.read");
      const admitted = await propose(
        app,
        token,
        proposalBody({ action_id: "complete_task", input: { task_id: taskId } }),
      );
      expect(admitted.input_summary).toContain("oncologist");
    });

    it("a malformed tool envelope is the same token-shaped refusal as a bad input, never echoed issues", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      const response = await app.inject({
        method: "POST",
        url: "/agent/tools/get_today_context",
        headers: agentHeaders(token),
        payload: { input: "not-an-object", correlation_id: "not-a-uuid" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "agent_tool_refused",
        error_class: "input_invalid",
      });
      expect(response.body).not.toContain("issues");
    });

    it("a read agent is 403 trust_insufficient before the body is parsed", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const response = await app.inject({
        method: "POST",
        url: "/agent/actions",
        headers: agentHeaders(token),
        payload: { not: "a proposal" },
      });
      expect(response.statusCode).toBe(403);
      const body = AgentRefusalSchema.parse(response.json());
      expect(body.error).toBe("agent_action_refused");
      expect(body.error_class).toBe("trust_insufficient");
      expect(await app.db.select().from(actionRequests)).toHaveLength(0);
    });

    it("a propose agent without tasks.write is 403 permission_not_granted", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      const response = await app.inject({
        method: "POST",
        url: "/agent/actions",
        headers: agentHeaders(token),
        payload: proposalBody(),
      });
      expect(response.statusCode).toBe(403);
      expect(AgentRefusalSchema.parse(response.json()).error_class).toBe("permission_not_granted");
      expect(await app.db.select().from(actionRequests)).toHaveLength(0);
    });

    it("with tasks.write: 201, the row is principal agent / source agent / source_ref = agent id with agent_id and correlation_id, the reason control-stripped, and the body carries no input or reason", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, {
        trust_level: "propose",
      });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const correlation = crypto.randomUUID();
      const item = await propose(
        app,
        token,
        proposalBody({
          reason: "Chapter 5\u0000is due\nThursday",
          correlation_id: correlation,
        }),
      );
      expect(item.status).toBe("pending");
      expect(item.action_id).toBe("create_task");
      expect(item.correlation_id).toBe(correlation);
      expect(item.input_summary).toContain("Read chapter 5");
      const raw = item as unknown as Record<string, unknown>;
      expect(raw["input"]).toBeUndefined();
      expect(raw["reason"]).toBeUndefined();

      const [row] = await app.db
        .select()
        .from(actionRequests)
        .where(eq(actionRequests.id, item.id));
      expect(row).toMatchObject({
        principal: "agent",
        source: "agent",
        sourceRef: agent.id,
        agentId: agent.id,
        correlationId: correlation,
        reason: "Chapter 5 is due Thursday",
      });
    });

    it("a repeated client_uuid returns 200 with the same id", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const clientUuid = crypto.randomUUID();
      const first = await propose(app, token, proposalBody({ client_uuid: clientUuid }));
      const replay = await propose(app, token, proposalBody({ client_uuid: clientUuid }), 200);
      expect(replay.id).toBe(first.id);
      expect(await app.db.select().from(actionRequests)).toHaveLength(1);
    });

    it("the agent's own body cannot smuggle a source, a source_ref, a principal or a reversal", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      for (const extra of [
        { source: "manual" },
        { source_ref: "someone-else" },
        { principal: "app" },
        { reverses_request_id: crypto.randomUUID() },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/agent/actions",
          headers: agentHeaders(token),
          payload: proposalBody(extra),
        });
        expect(response.statusCode, JSON.stringify(extra)).toBe(400);
        expect(response.json<ErrorBody>().error).toBe("validation_failed");
      }
    });
  });

  // ---- isolation -------------------------------------------------------------------

  describe("isolation between agents", () => {
    it("agent A cannot see or cancel agent B's request (404, never 403); A cancels its own pending; a completed one is 409", async () => {
      const a = await registerTestAgent(app, deviceToken, { name: "A", trust_level: "propose" });
      const b = await registerTestAgent(app, deviceToken, { name: "B", trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const mine = await propose(app, a.token, proposalBody());
      const theirs = await propose(app, b.token, proposalBody());

      const list = await app.inject({
        method: "GET",
        url: "/agent/actions",
        headers: agentHeaders(a.token),
      });
      const listed = AgentActionListResponseSchema.parse(list.json());
      expect(listed.items.map((item) => item.id)).toEqual([mine.id]);
      expect(listed.total).toBe(1);

      const peek = await app.inject({
        method: "GET",
        url: `/agent/actions/${theirs.id}`,
        headers: agentHeaders(a.token),
      });
      expect(peek.statusCode).toBe(404);
      expect(peek.json<ErrorBody>().error).toBe("action_not_found");

      const steal = await app.inject({
        method: "POST",
        url: `/agent/actions/${theirs.id}/cancel`,
        headers: agentHeaders(a.token),
      });
      expect(steal.statusCode).toBe(404);
      const [theirRow] = await app.db
        .select()
        .from(actionRequests)
        .where(eq(actionRequests.id, theirs.id));
      expect(theirRow?.status).toBe("pending");

      const cancel = await app.inject({
        method: "POST",
        url: `/agent/actions/${mine.id}/cancel`,
        headers: agentHeaders(a.token),
      });
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect(AgentActionItemSchema.parse(cancel.json()).status).toBe("cancelled");

      // B's request approved by the owner, then B tries to cancel it.
      const approve = await app.inject({
        method: "POST",
        url: `/actions/${theirs.id}/approve`,
        headers: agentHeaders(deviceToken),
      });
      expect(approve.statusCode, approve.body).toBe(200);
      const late = await app.inject({
        method: "POST",
        url: `/agent/actions/${theirs.id}/cancel`,
        headers: agentHeaders(b.token),
      });
      expect(late.statusCode).toBe(409);
      expect(late.json<ErrorBody>().error).toBe("action_not_pending");
    });
  });

  // ---- cross-principal grants ---------------------------------------------------------

  describe("cross-principal permission grants", () => {
    it("revoking tasks.write for app cancels only the app's pending rows; revoking it for agent cancels only the agent's", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, {
        trust_level: "propose",
      });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const agentRow = await propose(app, token, proposalBody());
      const appRow = await app.inject({
        method: "POST",
        url: "/actions",
        payload: {
          action_id: "create_task",
          input: { title: "Owner task", timezone: TZ },
          source: "manual",
        },
      });
      expect(appRow.statusCode).toBe(201);
      const appId = ActionRequestItemSchema.parse(appRow.json()).id;

      const revokeApp = await app.inject({
        method: "PATCH",
        url: "/permissions/tasks.write",
        headers: agentHeaders(deviceToken),
        payload: { granted: false },
      });
      expect(revokeApp.statusCode).toBe(200);
      expect(revokeApp.json<{ cancelled_pending: number }>().cancelled_pending).toBe(1);
      const statusOf = async (id: string) =>
        (await app.db.select().from(actionRequests).where(eq(actionRequests.id, id)))[0]?.status;
      expect(await statusOf(appId)).toBe("cancelled");
      expect(await statusOf(agentRow.id)).toBe("pending");

      const revokeAgent = await grantAgentPermission(app, deviceToken, "tasks.write", false);
      expect(revokeAgent.cancelled_pending).toBe(1);
      expect(await statusOf(agentRow.id)).toBe("cancelled");

      // And the other way round: the app grant back on, a fresh app row,
      // the agent grant back on, a fresh agent row, revoke the agent's.
      await app.inject({
        method: "PATCH",
        url: "/permissions/tasks.write",
        headers: agentHeaders(deviceToken),
        payload: { granted: true },
      });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const appAgain = ActionRequestItemSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/actions",
            payload: {
              action_id: "create_task",
              input: { title: "Owner task 2", timezone: TZ },
              source: "manual",
            },
          })
        ).json(),
      );
      const agentAgain = await propose(app, token, proposalBody());
      expect(
        (await grantAgentPermission(app, deviceToken, "tasks.write", false)).cancelled_pending,
      ).toBe(1);
      expect(await statusOf(appAgain.id)).toBe("pending");
      expect(await statusOf(agentAgain.id)).toBe("cancelled");
      expect(agent.id).toBeTruthy();
    });

    it("revoking a READ permission cancels nothing and reports 0", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      await grantAgentPermission(app, deviceToken, "context.read");
      await propose(app, token, proposalBody());
      expect(
        (await grantAgentPermission(app, deviceToken, "context.read", false)).cancelled_pending,
      ).toBe(0);
      const rows = await app.db.select().from(actionRequests);
      expect(rows.map((r) => r.status)).toEqual(["pending"]);
    });

    it("an agent row is refused at owner approval with permission_revoked when the agent grant was revoked around the route, even though the app grant is live", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const item = await propose(app, token, proposalBody());
      // Revoke around the route (the actions.test.ts idiom), so the pending
      // row is NOT cancelled and reaches the executor's own re-check.
      await app.db
        .update(permissionGrants)
        .set({ revokedAt: new Date() })
        .where(eq(permissionGrants.principal, "agent"));
      const appGrants = PermissionsResponseSchema.parse(
        (await app.inject({ method: "GET", url: "/permissions" })).json(),
      );
      expect(appGrants.items.find((g) => g.permission === "tasks.write")?.granted).toBe(true);

      const approve = await app.inject({
        method: "POST",
        url: `/actions/${item.id}/approve`,
        headers: agentHeaders(deviceToken),
      });
      expect(approve.statusCode, approve.body).toBe(200);
      const done = ActionRequestItemSchema.parse(approve.json());
      expect(done.status).toBe("failed");
      expect(done.error_class).toBe("permission_revoked");
      expect(await app.db.select().from(tasks)).toHaveLength(0);
    });
  });

  // ---- auth crossing -------------------------------------------------------------------

  describe("auth crossing", () => {
    it("an agent token on /devices is 401; a device token on /agent/manifest is 401; an agent token cannot approve", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "propose" });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const item = await propose(app, token, proposalBody());

      const devicesWithAgent = await app.inject({
        method: "GET",
        url: "/devices",
        headers: agentHeaders(token),
      });
      expect(devicesWithAgent.statusCode).toBe(401);
      expect(devicesWithAgent.json<ErrorBody>().error).toBe("invalid_token");

      const manifestWithDevice = await app.inject({
        method: "GET",
        url: "/agent/manifest",
        headers: agentHeaders(deviceToken),
      });
      expect(manifestWithDevice.statusCode).toBe(401);
      expect(manifestWithDevice.json<ErrorBody>().error).toBe("invalid_token");

      const approveWithAgent = await app.inject({
        method: "POST",
        url: `/actions/${item.id}/approve`,
        headers: agentHeaders(token),
      });
      expect(approveWithAgent.statusCode).toBe(401);
      expect(approveWithAgent.json<ErrorBody>().error).toBe("invalid_token");
      const [row] = await app.db
        .select()
        .from(actionRequests)
        .where(eq(actionRequests.id, item.id));
      expect(row?.status).toBe("pending");

      const agentGrantWithAgent = await app.inject({
        method: "PATCH",
        url: "/permissions/agent/items.read",
        headers: agentHeaders(token),
        payload: { granted: true },
      });
      expect(agentGrantWithAgent.statusCode).toBe(401);
    });

    it("/agent/* without a token is 401 unauthorized", async () => {
      const response = await app.inject({ method: "GET", url: "/agent/manifest" });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("unauthorized");
    });
  });

  // ---- wire freeze -----------------------------------------------------------------------

  describe("wire freeze for the deployed client", () => {
    it("GET /permissions keeps its 10.8 shape after agent grants exist, and GET /permissions/agent parses on its own", async () => {
      await grantAgentPermission(app, deviceToken, "context.read");
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const response = await app.inject({ method: "GET", url: "/permissions" });
      const body = PermissionsResponseSchema.parse(response.json());
      expect(body.disclosure_version).toBe(ACTION_PERMISSION_DISCLOSURE_VERSION);
      expect(body.items.map((item) => item.permission)).toEqual(["tasks.write", "calendar.write"]);
      for (const item of body.items) {
        expect(item.principal).toBe("app");
        expect(item.granted).toBe(true);
        expect(Object.keys(item).sort()).toEqual(
          [
            "permission",
            "principal",
            "label",
            "description",
            "category",
            "granted",
            "granted_at",
            "revoked_at",
            "disclosure_version",
            "needs_reconsent",
            "usage_count",
            "last_used_at",
            "action_ids",
          ].sort(),
        );
      }
      const agentList = AgentPermissionsResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: "/permissions/agent",
            headers: agentHeaders(deviceToken),
          })
        ).json(),
      );
      expect(agentList.items.map((g) => [g.permission, g.granted, g.kind])).toEqual([
        ["tasks.write", true, "write"],
        ["calendar.write", false, "write"],
        ["context.read", true, "read"],
        ["items.read", false, "read"],
        ["academic.read", false, "read"],
      ]);
      expect(agentList.items.find((g) => g.permission === "context.read")?.tool_names).toEqual([
        "search_personal_items",
        "get_today_context",
        "get_calendar_context",
        "get_task_context",
      ]);
    });

    it("PATCH /permissions/agent with a body never changes an app grant: the app param schema refuses the literal (400, the closed-vocabulary rule) and nothing is written", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/permissions/agent",
        headers: agentHeaders(deviceToken),
        payload: { granted: false },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
      expect(await app.db.select().from(permissionGrants)).toHaveLength(0);
      const appGrants = PermissionsResponseSchema.parse(
        (await app.inject({ method: "GET", url: "/permissions" })).json(),
      );
      expect(appGrants.items.every((item) => item.granted)).toBe(true);
      const agentGrants = AgentPermissionsResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: "/permissions/agent",
            headers: agentHeaders(deviceToken),
          })
        ).json(),
      );
      expect(agentGrants.items.every((item) => !item.granted)).toBe(true);
    });

    it("GET /actions lists an agent-sourced row that parses through the deployed ActionListResponseSchema", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, {
        trust_level: "propose",
      });
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const item = await propose(app, token, proposalBody());
      const response = await app.inject({ method: "GET", url: "/actions" });
      const list = ActionListResponseSchema.parse(response.json());
      const row = list.items.find((entry) => entry.id === item.id);
      expect(row).toMatchObject({ principal: "agent", source: "agent", source_ref: agent.id });
      expect(Object.keys(row!)).not.toContain("agent_id");
      expect(Object.keys(row!)).not.toContain("correlation_id");
    });
  });
});

describe("the agent gateway never logs the token, a title, a body or a reason", () => {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ logDestination: stream });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    chunks.length = 0;
  });

  it("across register, a tool call, a refusal, a failure and a proposal", async () => {
    const coreRecords: Record<string, unknown>[] = [];
    const restore = setLogSink({
      write: (_level, record) => {
        coreRecords.push(record);
      },
    });
    let token: string;
    try {
      const deviceToken = await pairTestDevice(app);
      const registered = await registerTestAgent(app, deviceToken, {
        name: "Zanzibar agent",
        trust_level: "propose",
      });
      token = registered.token;
      await grantAgentPermission(app, deviceToken, "context.read");
      await grantAgentPermission(app, deviceToken, "items.read");
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const noteId = await seedNote(app);
      await seedTask(app, { title: "Zanzibar task title" });
      await callTool(app, token, "get_today_context", { tz: TZ });
      await callTool(app, token, "get_item_context", { type: "note", id: noteId });
      await callTool(app, token, "get_academic_context", { tz: TZ }); // refused
      await callTool(app, token, "get_task_context", { id: crypto.randomUUID() }); // failed
      await callTool(app, token, "get_today_context", { tz: "Zanzibar/Nowhere" }); // input_invalid
      await propose(
        app,
        token,
        proposalBody({
          input: { title: "Zanzibar proposal", timezone: TZ },
          reason: "Zanzibar reason",
        }),
      );
      await app.inject({
        method: "POST",
        url: `/agents/${registered.agent.id}/revoke`,
        headers: agentHeaders(deviceToken),
      });
    } finally {
      restore();
    }
    await new Promise((resolve) => setImmediate(resolve));
    const joined = chunks.join("") + JSON.stringify(coreRecords);
    expect(token.length).toBeGreaterThan(40);
    expect(joined).toContain("agent.registered");
    expect(joined).toContain("agent.tool.completed");
    expect(joined).toContain("agent.tool.refused");
    expect(joined).toContain("agent.tool.failed");
    expect(joined).toContain("action.requested");
    expect(joined).toContain("agent.revoked");
    expect(joined).not.toContain(token);
    expect(joined).not.toContain(token.slice(AGENT_TOKEN_PREFIX.length));
    expect(joined.toLowerCase()).not.toContain("zanzibar");
    expect(joined).not.toContain(NOTE_BODY);
  });
});
