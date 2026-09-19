import {
  AgentActivityQuerySchema,
  AgentListResponseSchema,
  AgentRegisterResponseSchema,
  AgentRegisterSchema,
  AgentUpdateSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAgentActivity } from "../agent/activity.js";
import {
  AgentNotFoundError,
  AgentRevokedError,
  registerAgent,
  revokeAgent,
  updateAgent,
} from "../agent/service.js";
import { deviceAuthPreHandler } from "../plugins/device-auth.js";
import { getAgent, listAgents } from "../read-models/agents.js";

// The OWNER-facing half of the Agent Gateway (Checkpoint 10.9, ADR-081 §3,
// ADR-082): every route here is DEVICE-bound -- registered inside one
// sub-context with `deviceAuthPreHandler`, exactly as routes/devices.ts binds
// its own -- and never agent-bound. A process on the tailnet cannot register
// itself an agent token, raise an agent's trust or read an agent's activity;
// only a paired device can. An agent token is `invalid_token` here (the two
// hooks look in different tables and never share a route, Guard 8 (d)).
//
//   POST  /agents                register; the ONLY response carrying the token
//   GET   /agents                every agent, revoked ones included
//   GET   /agents/:id            one agent (404 agent_not_found)
//   PATCH /agents/:id            rename / change trust (409 agent_revoked)
//   POST  /agents/:id/revoke     idempotent; the token authenticates nothing after
//   GET   /agents/:id/activity   tool calls and proposals, newest first
//
// The raw token is generated in the service, returned once from POST /agents
// and never logged, stored or shown again; only its sha256 is kept.

const IdParamsSchema = z.object({ id: z.string().uuid() });

export default function agentsRoutes(app: FastifyInstance): void {
  app.register((authed) => {
    authed.addHook("preHandler", deviceAuthPreHandler);

    authed.post("/agents", async (request, reply) => {
      const body = AgentRegisterSchema.parse(request.body);
      const result = await registerAgent(app, body, new Date());
      reply.code(201);
      return AgentRegisterResponseSchema.parse({ agent: result.agent, token: result.token });
    });

    authed.get("/agents", async () => {
      return AgentListResponseSchema.parse({ items: await listAgents(app.db) });
    });

    authed.get<{ Params: { id: string } }>("/agents/:id", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      const agent = await getAgent(app.db, params.id);
      if (!agent) {
        reply.code(404);
        return { error: "agent_not_found" };
      }
      return agent;
    });

    authed.patch<{ Params: { id: string } }>("/agents/:id", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      const body = AgentUpdateSchema.parse(request.body);
      try {
        return await updateAgent(app, params.id, body, new Date());
      } catch (err: unknown) {
        if (err instanceof AgentNotFoundError) {
          reply.code(404);
          return { error: "agent_not_found" };
        }
        if (err instanceof AgentRevokedError) {
          reply.code(409);
          return { error: "agent_revoked" };
        }
        throw err;
      }
    });

    authed.post<{ Params: { id: string } }>("/agents/:id/revoke", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      try {
        return await revokeAgent(app, params.id, new Date());
      } catch (err: unknown) {
        if (err instanceof AgentNotFoundError) {
          reply.code(404);
          return { error: "agent_not_found" };
        }
        throw err;
      }
    });

    authed.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      "/agents/:id/activity",
      async (request, reply) => {
        const params = IdParamsSchema.parse(request.params);
        const query = AgentActivityQuerySchema.parse(request.query);
        const agent = await getAgent(app.db, params.id);
        if (!agent) {
          reply.code(404);
          return { error: "agent_not_found" };
        }
        return listAgentActivity(app.db, params.id, query, new Date());
      },
    );
  });
}
