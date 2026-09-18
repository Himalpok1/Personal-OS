import { ActionPermissionSchema, PermissionUpdateSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setPermissionGrant } from "../actions/service.js";
import { listPermissionGrants } from "../read-models/actions.js";

// The owner-facing permission layer (Checkpoint 10.8, ADR-078 §3).
//
//   GET   /permissions               every permission with its grant state and usage
//   PATCH /permissions/:permission   { granted } for the `app` principal
//
// Only the `app` principal is reachable in 10.8: no route can grant anything
// to `agent` (a future agent ADR adds that surface, with its own disclosure).
// Granting a permission is NOT an action -- this is the consent gate itself,
// so it lives outside the registry and no action can call it (ADR-078 §2).
// An unknown permission is a 400 from the Zod enum, not a 404: the
// vocabulary is closed. A revoke cancels the pending requests that needed
// it, in the same transaction, and the response says how many.

const ParamsSchema = z.object({ permission: ActionPermissionSchema });

export default function permissionsRoutes(app: FastifyInstance): void {
  app.get("/permissions", async () => listPermissionGrants(app.db, "app"));

  app.patch<{ Params: { permission: string } }>("/permissions/:permission", async (request) => {
    const params = ParamsSchema.parse(request.params);
    const body = PermissionUpdateSchema.parse(request.body);
    return setPermissionGrant(app, params.permission, body.granted, new Date());
  });
}
