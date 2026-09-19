import {
  ACTION_REGISTRY,
  AgentActionCreateSchema,
  AgentActionListQuerySchema,
  AgentRefusalSchema,
  AgentToolCallRequestSchema,
  ReadToolNameSchema,
  trustLevelAtLeast,
  type ActionRequestCreate,
  type AgentTrustLevel,
} from "@personal-os/schema";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ActionPermissionDeniedError,
  ActionRequestNotFoundError,
  ActionRequestNotPendingError,
  cancelActionRequest,
  createActionRequest,
} from "../actions/service.js";
import { ActionValidationError } from "../actions/types.js";
import { buildAgentManifest } from "../agent/manifest.js";
import { runReadTool } from "../agent/tools.js";
import { agentAuthPreHandler } from "../plugins/agent-auth.js";
import {
  getActionRequestForAgent,
  isPermissionGranted,
  listActionRequestsForAgent,
} from "../read-models/actions.js";

// The AGENT-facing half of the Agent Gateway (Checkpoint 10.9, ADR-081):
// every route here is bound by `agentAuthPreHandler` and nothing else, in
// ONE encapsulated sub-context, so no agent route can exist outside it and
// no owner route can be reached with an agent token.
//
//   GET  /agent/manifest              what this agent may call and request
//   POST /agent/tools/:tool_name      one budgeted, audited read-tool call
//   POST /agent/actions               PROPOSE an action (principal `agent`)
//   GET  /agent/actions[?status=]     this agent's OWN proposals
//   GET  /agent/actions/:id           one of its own (404 for anyone else's)
//   POST /agent/actions/:id/cancel    withdraw its own pending proposal
//
// What is absent is the point: no approval route, no permission route, no
// undo (a reversal is the owner's tap), no route that reads another agent's
// rows. An agent's proposal waits in the Action Center like the owner's own
// Focus Now proposal does; the owner approves from a paired device
// (ADR-082). Refusal bodies are token-shaped (`error_class`), never prose
// from a tool, a schema or a provider, and no route here logs an input, an
// output, a title or a reason -- the service lines are ids-only.

const ToolParamsSchema = z.object({ tool_name: ReadToolNameSchema });
const IdParamsSchema = z.object({ id: z.string().uuid() });

/** Proposing needs the `propose` level; `read` may only call tools. */
const PROPOSE_REQUIRED_TRUST: AgentTrustLevel = "propose";

export default function agentRoutes(app: FastifyInstance): void {
  app.register((authed) => {
    authed.addHook("preHandler", agentAuthPreHandler);

    authed.get("/agent/manifest", async (request) => {
      return buildAgentManifest(app.db, request.agent!);
    });

    authed.post<{ Params: { tool_name: string } }>(
      "/agent/tools/:tool_name",
      async (request, reply) => {
        // An unknown tool is a 404 with the gateway's own vocabulary, not a
        // Zod 400 echoing the enum: the manifest is the list.
        const params = ToolParamsSchema.safeParse(request.params);
        if (!params.success) {
          reply.code(404);
          return { error: "tool_unknown" };
        }
        const body = AgentToolCallRequestSchema.parse(request.body);
        const result = await runReadTool(
          app,
          request,
          request.agent!,
          params.data.tool_name,
          body,
          new Date(),
        );
        reply.code(result.status);
        return result.body;
      },
    );

    authed.post("/agent/actions", async (request, reply) => {
      const agent = request.agent!;
      // Trust first, before the body is even parsed: a `read` agent learns
      // it may not propose at all, not which field of its proposal was off.
      if (!trustLevelAtLeast(agent.trustLevel as AgentTrustLevel, PROPOSE_REQUIRED_TRUST)) {
        reply.code(403);
        return actionRefusal("trust_insufficient");
      }
      const body = AgentActionCreateSchema.parse(request.body);
      const definition = ACTION_REGISTRY[body.action_id];
      if (!(await isPermissionGranted(app.db, "agent", definition.permission))) {
        reply.code(403);
        return actionRefusal("permission_not_granted");
      }
      // Built explicitly, field by field: the agent's body carries no
      // `source`, `source_ref`, `principal` or `reverses_request_id`, and the
      // service writes `agent` / the agent's id from the attribution
      // regardless of what this object says.
      const create = {
        action_id: body.action_id,
        input: body.input,
        source: "agent",
        reason: body.reason,
        ...(body.client_uuid !== undefined && { client_uuid: body.client_uuid }),
      } as ActionRequestCreate;
      const now = new Date();
      try {
        const result = await createActionRequest(app, create, now, {
          principal: "agent",
          agentId: agent.id,
          correlationId: body.correlation_id,
        });
        reply.code(result.created ? 201 : 200);
        const own = await getActionRequestForAgent(app.db, agent.id, result.item.id, now);
        if (own === null) {
          // A repeated client_uuid that belongs to ANOTHER principal's row:
          // the id is not this agent's to see.
          reply.code(404);
          return { error: "action_not_found" };
        }
        return own;
      } catch (err: unknown) {
        if (err instanceof ActionPermissionDeniedError) {
          reply.code(403);
          return actionRefusal("permission_not_granted");
        }
        if (err instanceof ActionValidationError) {
          reply.code(400);
          return { error: "validation_failed", issues: [err.issue] };
        }
        throw err;
      }
    });

    authed.get<{ Querystring: Record<string, string> }>("/agent/actions", async (request) => {
      const query = AgentActionListQuerySchema.parse(request.query);
      return listActionRequestsForAgent(app.db, request.agent!.id, query, new Date());
    });

    authed.get<{ Params: { id: string } }>("/agent/actions/:id", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      const item = await getActionRequestForAgent(app.db, request.agent!.id, params.id, new Date());
      if (!item) {
        reply.code(404);
        return { error: "action_not_found" };
      }
      return item;
    });

    authed.post<{ Params: { id: string } }>("/agent/actions/:id/cancel", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      const now = new Date();
      try {
        const cancelled = await cancelActionRequest(app, params.id, now, {
          agentId: request.agent!.id,
        });
        // Re-read through the agent's own projection (never the owner item
        // the service returns): no `input`, no `reason`.
        const own = await getActionRequestForAgent(app.db, request.agent!.id, cancelled.id, now);
        if (own === null) throw new Error("agent action row vanished between cancel and read-back");
        return own;
      } catch (err: unknown) {
        return lifecycleError(err, reply);
      }
    });
  });
}

function actionRefusal(errorClass: "trust_insufficient" | "permission_not_granted") {
  return AgentRefusalSchema.parse({ error: "agent_action_refused", error_class: errorClass });
}

function lifecycleError(err: unknown, reply: FastifyReply): { error: string; status?: string } {
  if (err instanceof ActionRequestNotFoundError) {
    reply.code(404);
    return { error: "action_not_found" };
  }
  if (err instanceof ActionRequestNotPendingError) {
    reply.code(409);
    return {
      error: err.status === "expired" ? "action_expired" : "action_not_pending",
      status: err.status,
    };
  }
  throw err;
}
