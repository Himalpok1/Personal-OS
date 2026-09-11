// Cloud Ask -- the runtime authorization boundary (Checkpoint 8.6B design §6).
//
// ===========================================================================
// WHY THIS IS A RUNTIME CHECK, NOT A TYPE
// ===========================================================================
//
// The design's first draft claimed a compile-time guarantee via a branded
// type. Adversarial review refuted it: a TypeScript brand has no runtime
// existence, a two-step type coercion through `unknown` forges it anywhere, a
// function taking only a `db` handle is callable from the API process's own
// `setInterval` lane (`plugins/heartbeat-watchdog.ts`), and a regex ratchet is
// evaded by an aliased import. What follows is the load-bearing guard instead:
// a `WeakSet` of objects minted ONLY inside `authorizeCloudAsk`, which itself
// requires a live `FastifyRequest` -- something a timer or a pg-boss job does
// not have. `assertGrant` is the single gate every body-reading or
// model-calling function in this lane must pass, and it throws on ANY value
// not literally present in that set, including a structurally identical
// look-alike object.
//
// This is protection against an accidental new call site, not against a
// determined attacker with write access to this same process's source --
// nothing in a monorepo can be. What it DOES close: the switch (the "ask" row
// in ai_task_routes) is checked BEFORE any note or task row is read, and
// nothing downstream of a `null` grant can read one either, because nothing
// downstream can construct a grant for itself.
import { aiTaskRoutes } from "@personal-os/db";
import type { Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { ASK_TASK_NAME } from "./contracts.js";

export interface CloudAskGrant {
  readonly requestId: string;
  readonly grantedAt: string;
}

/** Objects actually minted by `authorizeCloudAsk`. Nothing else is ever added. */
const grants = new WeakSet<object>();

/** Whether the `ask` task route exists at all -- its presence IS the switch. */
export async function askRouteEnabled(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: aiTaskRoutes.id })
    .from(aiTaskRoutes)
    .where(eq(aiTaskRoutes.taskName, ASK_TASK_NAME));
  return row !== undefined;
}

/**
 * Checks the switch and, if it is on, mints a fresh, single-use grant bound to
 * this HTTP request. Returns `null` when Cloud Ask is disabled -- the route
 * maps that to `409 cloud_ask_disabled` having read no `notes`/`tasks` row at
 * all.
 *
 * Requires a live `FastifyRequest` rather than merely a `db` handle -- a
 * `setInterval` callback or a pg-boss job has neither a request nor any
 * legitimate reason to have one, which is what keeps a background caller from
 * minting its own grant by accident.
 */
export async function authorizeCloudAsk(
  request: FastifyRequest,
  db: Db,
): Promise<CloudAskGrant | null> {
  if (!(await askRouteEnabled(db))) return null;
  const grant: CloudAskGrant = Object.freeze({
    requestId: request.id,
    grantedAt: new Date().toISOString(),
  });
  grants.add(grant);
  return grant;
}

/**
 * The single gate. Every function that reads a note/task body or calls the
 * model for Ask must call this FIRST. A forged object -- any cast, any
 * structural look-alike constructed with the right shape -- is not a member of
 * the `WeakSet` and throws here, before a single row is read.
 */
export function assertGrant(grant: unknown): asserts grant is CloudAskGrant {
  if (typeof grant !== "object" || grant === null || !grants.has(grant)) {
    throw new AskUnauthorizedError();
  }
}

/**
 * Consumes a grant so it authorizes at most one generation call. Idempotent on
 * a grant that was already consumed or was never valid -- callers that hit
 * this twice (which should not happen on the single request path this lane
 * has) get the same "not authorized" outcome as never having had one.
 */
export function consumeGrant(grant: CloudAskGrant): void {
  grants.delete(grant);
}

export class AskUnauthorizedError extends Error {
  constructor() {
    super("no valid Cloud Ask authorization for this call");
    this.name = "AskUnauthorizedError";
  }
}
