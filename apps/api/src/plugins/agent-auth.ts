import { hashAgentToken, looksLikeAgentToken } from "@personal-os/core";
import { agents } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    agent?: typeof agents.$inferSelect;
  }
}

// Checkpoint 10.9 (ADR-081): the AGENT principal's bearer hook -- a clone of
// plugins/device-auth.ts against the `agents` table, attached per-route-file
// via addHook("preHandler", ...) inside the `/agent/*` sub-context
// (routes/agent.ts) and never registered app-wide.
//
// The two hooks never share a route (Guard 8 (d)): an agent token looks in
// `agents.token_hash` only, a device token in `devices.token_hash` only, so a
// valid device token is `invalid_token` here and an agent token is
// `invalid_token` on `/devices/*` -- the tables are disjoint and the hash is
// never compared across them. `looksLikeAgentToken` is a cheap shape check
// (the `posa_` prefix plus a minimum length) that spares the hash for a
// value that cannot be an agent token; it is not the authorization.
//
// SECURITY BOUNDARY: a valid, unrevoked agent token authenticates only the
// `/agent/*` routes this hook guards -- the manifest, the read tools and the
// agent's OWN proposals. It grants nothing on any owner route: approval,
// permission changes and agent management are device-bound (ADR-082), and
// every other route stays Tailscale-perimeter-only exactly as before. A
// revoked agent's token authenticates nothing; revocation is a timestamp, so
// its audit rows keep their attribution.
//
// The raw token is never logged, never stored and never echoed: only its
// sha256 is compared, and this hook emits no log line of its own.
export async function agentAuthPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  if (!looksLikeAgentToken(token)) {
    return reply.code(401).send({ error: "invalid_token" });
  }

  const tokenHash = hashAgentToken(token);
  const [row] = await request.server.db
    .select()
    .from(agents)
    .where(eq(agents.tokenHash, tokenHash));

  if (!row) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  if (row.revokedAt) {
    return reply.code(401).send({ error: "agent_revoked" });
  }

  // Diagnostic only, NOT a heartbeat -- the devices.last_seen_at rule.
  await request.server.db
    .update(agents)
    .set({ lastSeenAt: new Date() })
    .where(eq(agents.id, row.id));

  request.agent = row;
}
