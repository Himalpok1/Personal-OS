import { devices } from "@personal-os/db";
import {
  AGENT_DISCLOSURE_VERSION,
  AGENT_NAME_MAX_CHARS,
  AgentActivityResponseSchema,
  AgentListResponseSchema,
  AgentSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentHeaders,
  grantAgentPermission,
  pairTestDevice,
  registerTestAgent,
} from "../test/agents.test-support.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.9 (ADR-081 §3, ADR-082) -- the OWNER-facing agent routes:
// device-bound registration, listing, editing, revocation and the merged
// activity timeline.

const OWNER_ROUTES = [
  { method: "POST" as const, url: "/agents", payload: { name: "x", trust_level: "read" } },
  { method: "GET" as const, url: "/agents" },
  { method: "GET" as const, url: `/agents/${crypto.randomUUID()}` },
  {
    method: "PATCH" as const,
    url: `/agents/${crypto.randomUUID()}`,
    payload: { trust_level: "read" },
  },
  { method: "POST" as const, url: `/agents/${crypto.randomUUID()}/revoke` },
  { method: "GET" as const, url: `/agents/${crypto.randomUUID()}/activity` },
  { method: "GET" as const, url: "/permissions/agent" },
  {
    method: "PATCH" as const,
    url: "/permissions/agent/context.read",
    payload: { granted: true },
  },
  { method: "PATCH" as const, url: "/permissions/tasks.write", payload: { granted: true } },
  { method: "POST" as const, url: `/actions/${crypto.randomUUID()}/approve` },
  { method: "POST" as const, url: `/actions/${crypto.randomUUID()}/cancel` },
];

describe("owner agent routes (/agents/*)", () => {
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
    deviceToken = await pairTestDevice(app);
  });

  // ---- binding ----------------------------------------------------------------

  describe("device binding (ADR-082)", () => {
    it("every owner route -- agents, agent permissions, the app permission PATCH, approve and cancel -- is 401 unauthorized without a token", async () => {
      for (const route of OWNER_ROUTES) {
        const response = await app.inject(route);
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
        expect(response.json<ErrorBody>().error).toBe("unauthorized");
      }
    });

    it("is 401 device_revoked for a revoked device and 401 invalid_token for an agent token", async () => {
      const { token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await app.db.update(devices).set({ revokedAt: new Date() });
      for (const route of OWNER_ROUTES) {
        const revoked = await app.inject({ ...route, headers: agentHeaders(deviceToken) });
        expect(revoked.statusCode, `${route.method} ${route.url}`).toBe(401);
        expect(revoked.json<ErrorBody>().error).toBe("device_revoked");
        const crossed = await app.inject({ ...route, headers: agentHeaders(token) });
        expect(crossed.statusCode, `${route.method} ${route.url}`).toBe(401);
        expect(crossed.json<ErrorBody>().error).toBe("invalid_token");
      }
    });
  });

  // ---- register / list / get -----------------------------------------------------

  describe("POST /agents, GET /agents, GET /agents/:id", () => {
    it("registers with the current disclosure version, lists newest first including revoked agents, and 404s an unknown id", async () => {
      const first = await registerTestAgent(app, deviceToken, {
        name: "First",
        trust_level: "none",
      });
      expect(first.agent.disclosure_version).toBe(AGENT_DISCLOSURE_VERSION);
      expect(first.agent.trust_level).toBe("none");
      expect(first.agent.revoked_at).toBeNull();
      expect(first.agent.last_seen_at).toBeNull();
      const second = await registerTestAgent(app, deviceToken, {
        name: "Second",
        trust_level: "propose",
      });
      await app.inject({
        method: "POST",
        url: `/agents/${first.agent.id}/revoke`,
        headers: agentHeaders(deviceToken),
      });

      const list = await app.inject({
        method: "GET",
        url: "/agents",
        headers: agentHeaders(deviceToken),
      });
      const body = AgentListResponseSchema.parse(list.json());
      expect(body.items.map((agent) => agent.name)).toEqual(["Second", "First"]);
      expect(body.items[1]?.revoked_at).not.toBeNull();

      const one = await app.inject({
        method: "GET",
        url: `/agents/${second.agent.id}`,
        headers: agentHeaders(deviceToken),
      });
      expect(AgentSchema.parse(one.json()).id).toBe(second.agent.id);

      const missing = await app.inject({
        method: "GET",
        url: `/agents/${crypto.randomUUID()}`,
        headers: agentHeaders(deviceToken),
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json<ErrorBody>().error).toBe("agent_not_found");
    });

    it("refuses an empty, over-long or whitespace name and an unknown trust level (400)", async () => {
      for (const payload of [
        { name: "", trust_level: "read" },
        { name: "   ", trust_level: "read" },
        { name: "x".repeat(AGENT_NAME_MAX_CHARS + 1), trust_level: "read" },
        { name: "ok", trust_level: "operator" },
        { name: "ok" },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/agents",
          headers: agentHeaders(deviceToken),
          payload,
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(response.json<ErrorBody>().error).toBe("validation_failed");
      }
    });

    it("bumps last_seen_at when the agent calls the gateway, visible to the owner", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "read" });
      await app.inject({ method: "GET", url: "/agent/manifest", headers: agentHeaders(token) });
      const one = await app.inject({
        method: "GET",
        url: `/agents/${agent.id}`,
        headers: agentHeaders(deviceToken),
      });
      expect(AgentSchema.parse(one.json()).last_seen_at).not.toBeNull();
    });
  });

  // ---- update ---------------------------------------------------------------------

  describe("PATCH /agents/:id", () => {
    it("renames and changes trust, refuses an empty patch, and 404s an unknown id", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, { trust_level: "none" });
      const response = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        headers: agentHeaders(deviceToken),
        payload: { name: "Renamed", trust_level: "read" },
      });
      expect(response.statusCode, response.body).toBe(200);
      const updated = AgentSchema.parse(response.json());
      expect(updated.name).toBe("Renamed");
      expect(updated.trust_level).toBe("read");
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(agent.updated_at).getTime(),
      );
      // The new level is effective on the very next agent call.
      await grantAgentPermission(app, deviceToken, "context.read");
      const call = await app.inject({
        method: "POST",
        url: "/agent/tools/get_today_context",
        headers: agentHeaders(token),
        payload: { input: { tz: "UTC" }, correlation_id: crypto.randomUUID() },
      });
      expect(call.statusCode, call.body).toBe(200);

      const empty = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        headers: agentHeaders(deviceToken),
        payload: {},
      });
      expect(empty.statusCode).toBe(400);

      const missing = await app.inject({
        method: "PATCH",
        url: `/agents/${crypto.randomUUID()}`,
        headers: agentHeaders(deviceToken),
        payload: { name: "x" },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json<ErrorBody>().error).toBe("agent_not_found");
    });
  });

  // ---- activity ---------------------------------------------------------------------

  describe("GET /agents/:id/activity", () => {
    it("merges tool calls and proposals newest first with an honest total, paginates, and 404s an unknown agent", async () => {
      const { agent, token } = await registerTestAgent(app, deviceToken, {
        trust_level: "propose",
      });
      await grantAgentPermission(app, deviceToken, "context.read");
      await grantAgentPermission(app, deviceToken, "tasks.write");
      const correlation = crypto.randomUUID();
      const read = await app.inject({
        method: "POST",
        url: "/agent/tools/get_today_context",
        headers: agentHeaders(token),
        payload: { input: { tz: "UTC" }, correlation_id: correlation },
      });
      expect(read.statusCode, read.body).toBe(200);
      const refused = await app.inject({
        method: "POST",
        url: "/agent/tools/get_academic_context",
        headers: agentHeaders(token),
        payload: { input: { tz: "UTC" }, correlation_id: correlation },
      });
      expect(refused.statusCode).toBe(403);
      const proposed = await app.inject({
        method: "POST",
        url: "/agent/actions",
        headers: agentHeaders(token),
        payload: {
          action_id: "create_task",
          input: { title: "Read chapter 5", timezone: "UTC" },
          reason: "Because the syllabus says so",
          correlation_id: correlation,
        },
      });
      expect(proposed.statusCode, proposed.body).toBe(201);

      const response = await app.inject({
        method: "GET",
        url: `/agents/${agent.id}/activity`,
        headers: agentHeaders(deviceToken),
      });
      expect(response.statusCode, response.body).toBe(200);
      const activity = AgentActivityResponseSchema.parse(response.json());
      expect(activity.total).toBe(3);
      expect(activity.items).toHaveLength(3);
      expect(activity.items.map((item) => item.kind)).toEqual([
        "action_request",
        "tool_call",
        "tool_call",
      ]);
      for (const item of activity.items) expect(item.correlation_id).toBe(correlation);
      const request = activity.items[0];
      expect(request?.kind === "action_request" && request.request.principal).toBe("agent");
      expect(request?.kind === "action_request" && request.request.reason).toBe(
        "Because the syllabus says so",
      );
      const calls = activity.items.filter((item) => item.kind === "tool_call");
      expect(calls.map((c) => c.kind === "tool_call" && c.tool_call.status).sort()).toEqual([
        "completed",
        "refused",
      ]);

      const page = AgentActivityResponseSchema.parse(
        (
          await app.inject({
            method: "GET",
            url: `/agents/${agent.id}/activity?limit=1&offset=1`,
            headers: agentHeaders(deviceToken),
          })
        ).json(),
      );
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.kind).toBe("tool_call");

      const missing = await app.inject({
        method: "GET",
        url: `/agents/${crypto.randomUUID()}/activity`,
        headers: agentHeaders(deviceToken),
      });
      expect(missing.statusCode).toBe(404);
    });
  });
});
