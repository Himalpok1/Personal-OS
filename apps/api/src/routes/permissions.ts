import {
  ActionPermissionSchema,
  AgentPermissionSchema,
  PermissionUpdateSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setPermissionGrant } from "../actions/service.js";
import { deviceAuthPreHandler } from "../plugins/device-auth.js";
import { listAgentPermissionGrants, listPermissionGrants } from "../read-models/actions.js";

// The owner-facing permission layer (Checkpoint 10.8, ADR-078 §3; widened to
// the `agent` principal in Checkpoint 10.9, ADR-081 §4).
//
//   GET   /permissions                     every APP permission with its grant state and usage
//   GET   /permissions/agent               every AGENT permission (read + write)       (DEVICE-bound)
//   PATCH /permissions/:permission         { granted } for the `app` principal        (DEVICE-bound)
//   PATCH /permissions/agent/:permission   { granted } for the `agent` principal      (DEVICE-bound)
//
// Granting a permission is NOT an action -- this is the consent gate itself,
// so it lives outside the registry and no action can call it (ADR-078 §2).
// Since ADR-082 every PATCH here, and every `/permissions/agent*` route, is
// bound to a paired device's bearer token: a process on the tailnet can no
// longer grant itself (or an agent) a permission, nor read what an agent has
// been granted. `GET /permissions` stays the perimeter-only read it was and
// keeps its 10.8 shape byte-for-byte for the deployed client; an agent reads
// its own grants from the manifest.
//
// `/permissions/agent/:permission` is a fixed segment ahead of the
// `/permissions/:permission` parameter route; find-my-way prefers the static
// segment whatever the registration order. A PATCH to the bare
// `/permissions/agent` does reach the app param route, where
// `ActionPermissionSchema` refuses the literal "agent" with a 400 before
// anything is read or written -- the test pins that nothing changes. An
// unknown permission is a 400 from the Zod enum, not a 404: both
// vocabularies are closed. A revoke cancels the pending requests OF THAT
// PRINCIPAL that needed it, in the same transaction, and the response says
// how many.

const AppParamsSchema = z.object({ permission: ActionPermissionSchema });
const AgentParamsSchema = z.object({ permission: AgentPermissionSchema });

export default function permissionsRoutes(app: FastifyInstance): void {
  app.get("/permissions", async () => listPermissionGrants(app.db, "app"));

  app.register((authed) => {
    authed.addHook("preHandler", deviceAuthPreHandler);

    authed.get("/permissions/agent", async () => listAgentPermissionGrants(app.db));

    authed.patch<{ Params: { permission: string } }>(
      "/permissions/agent/:permission",
      async (request) => {
        const params = AgentParamsSchema.parse(request.params);
        const body = PermissionUpdateSchema.parse(request.body);
        return setPermissionGrant(app, params.permission, body.granted, new Date(), "agent");
      },
    );

    authed.patch<{ Params: { permission: string } }>(
      "/permissions/:permission",
      async (request) => {
        const params = AppParamsSchema.parse(request.params);
        const body = PermissionUpdateSchema.parse(request.body);
        return setPermissionGrant(app, params.permission, body.granted, new Date());
      },
    );
  });
}
