import { hashDeviceToken } from "@personal-os/core";
import { devices } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    device?: typeof devices.$inferSelect;
  }
}

// Attached per-route-file via addHook("preHandler", ...) inside an
// authenticated Fastify sub-context (see routes/devices.ts) -- never
// registered app-wide. Fastify's plugin encapsulation means this can never
// leak onto the existing tasks/notes/projects/capture/inbox/occurrences
// routes, which remain Tailscale-perimeter-only, unchanged.
//
// SECURITY BOUNDARY: a valid, unrevoked device token authenticates only
// the device/notification-specific routes this hook guards. It does NOT
// grant or restrict access to any other endpoint in this API -- those are
// (and remain) reachable by anything on the tailnet, exactly as in
// Phase 2. Revoking a device (see routes/devices.ts's /revoke) stops that
// device's token from passing this check, but does nothing to its ability
// to reach /tasks, /notes, /capture, or the web UI. A genuinely lost or
// stolen device must still be removed from the tailnet to fully cut off
// its general Personal OS access -- see docs/DECISIONS.md.
export async function deviceAuthPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  const tokenHash = hashDeviceToken(token);
  const [row] = await request.server.db
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, tokenHash));

  if (!row) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  if (row.revokedAt) {
    return reply.code(401).send({ error: "device_revoked" });
  }

  // Diagnostic only, NOT a heartbeat -- see docs/ARCHITECTURE.md.
  await request.server.db
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.id, row.id));

  request.device = row;
}
