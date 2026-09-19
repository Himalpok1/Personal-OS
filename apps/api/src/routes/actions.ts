import { ActionListQuerySchema, ActionRequestCreateSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActionPermissionDeniedError,
  ActionRequestNotFoundError,
  ActionRequestNotPendingError,
  approveActionRequest,
  cancelActionRequest,
  createActionRequest,
} from "../actions/service.js";
import { ActionValidationError } from "../actions/types.js";
import { deviceAuthPreHandler } from "../plugins/device-auth.js";
import {
  getActionRequestItem,
  getActionsSummary,
  listActionRequests,
} from "../read-models/actions.js";

// The Action Framework's request lifecycle (Checkpoint 10.8, ADR-078 §4).
//
//   POST /actions              propose  -> 201 pending (200 for a repeated client_uuid)
//   POST /actions/:id/approve  approve  -> 200 completed | failed   (executes HERE, one tx)  DEVICE-bound
//   POST /actions/:id/cancel   cancel   -> 200 cancelled                                     DEVICE-bound
//   GET  /actions[?status=]    the audit trail, newest first
//   GET  /actions/summary      counts for the Settings and Today cards
//   GET  /actions/:id          one row
//
// Since Checkpoint 10.9 (ADR-082) approve and cancel are bound to a paired
// device's bearer token, inside one sub-context with `deviceAuthPreHandler`
// exactly as routes/devices.ts binds its own: a process on the tailnet --
// an agent included -- can PROPOSE (that is what proposing is for; it still
// waits for approval) but can never approve its own proposal or withdraw
// the owner's. The GETs and `POST /actions` stay perimeter-only.
//
// `principal` is never client-supplied (ActionRequestCreateSchema has no such
// field; the service writes `app`). A failed execution is a 200 with the
// failed row: the DECISION was recorded and the audit row is the answer --
// the client reads `status`/`error_class`, never a thrown 500. Routes never
// log a title, a summary or the input; the service's own lines are ids-only.
// Guard 7 denies every enqueue token in this file: an action never rides a
// job from here (the calendar push runs post-commit inside the service's
// `afterCommit`, exactly as routes/events.ts does it).

const IdParamsSchema = z.object({ id: z.string().uuid() });

export default function actionsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/actions", async (request) => {
    const query = ActionListQuerySchema.parse(request.query);
    return listActionRequests(app.db, query, new Date());
  });

  // Static segment ahead of `/actions/:id` (find-my-way matches it first
  // regardless of order; this order just reads the way the router resolves).
  app.get("/actions/summary", async () => getActionsSummary(app.db, new Date()));

  app.get<{ Params: { id: string } }>("/actions/:id", async (request, reply) => {
    const params = IdParamsSchema.parse(request.params);
    const item = await getActionRequestItem(app.db, params.id, new Date());
    if (!item) {
      reply.code(404);
      return { error: "action_not_found" };
    }
    return item;
  });

  app.post("/actions", async (request, reply) => {
    const body = ActionRequestCreateSchema.parse(request.body);
    try {
      const result = await createActionRequest(app, body, new Date());
      reply.code(result.created ? 201 : 200);
      return result.item;
    } catch (err: unknown) {
      if (err instanceof ActionPermissionDeniedError) {
        reply.code(403);
        return { error: "action_permission_denied", permission: err.permission };
      }
      if (err instanceof ActionValidationError) {
        reply.code(400);
        return { error: "validation_failed", issues: [err.issue] };
      }
      throw err;
    }
  });

  app.register((authed) => {
    authed.addHook("preHandler", deviceAuthPreHandler);

    authed.post<{ Params: { id: string } }>("/actions/:id/approve", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      try {
        return await approveActionRequest(app, params.id, new Date());
      } catch (err: unknown) {
        return lifecycleError(err, reply);
      }
    });

    authed.post<{ Params: { id: string } }>("/actions/:id/cancel", async (request, reply) => {
      const params = IdParamsSchema.parse(request.params);
      try {
        return await cancelActionRequest(app, params.id, new Date());
      } catch (err: unknown) {
        return lifecycleError(err, reply);
      }
    });
  });
}

function lifecycleError(
  err: unknown,
  reply: { code(status: number): unknown },
): { error: string; status?: string } {
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
