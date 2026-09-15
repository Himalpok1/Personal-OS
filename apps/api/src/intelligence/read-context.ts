// Checkpoint 9.7 -- the read context every intelligence read is given INSTEAD
// of a raw `Db` (ADR-066).
//
// Why a wrapper around four fields: (1) ONE `effectiveNow` per request, the
// frozen read-model rule (docs/ARCHITECTURE.md "Today & agenda read models"),
// threaded exactly as brief/collect-input.ts threads it into
// buildTodayResponse; (2) the request `tz`, validated once, so no reader ever
// guesses a zone; (3) the Cloud Ask grant, so every intelligence read is
// gated by the same request-scoped, unforgeable authorization that gates a
// note/task body read (ask/authorize.ts) -- a pg-boss job or a timer has no
// FastifyRequest and therefore cannot mint one; (4) `db` behind a field name,
// so a future SELECT-only role (deferred with the agent ADR) is a one-line
// swap at the mint site and zero call-site changes.
//
// NO `ai` IMPORT, NO PROVIDER IMPORT, NO WRITE VERB may ever appear under
// apps/api/src/intelligence/ -- pinned by Guard 4 in ask/ai-egress-guard.test.ts.
import type { Db } from "@personal-os/db";
import type { FastifyRequest } from "fastify";
import { assertGrant, type CloudAskGrant } from "../ask/authorize.js";

export interface ReadContext {
  readonly db: Db;
  readonly effectiveNow: Date;
  readonly tz: string;
  readonly grant: CloudAskGrant;
}

/**
 * Packages a live request's already-minted Cloud Ask grant with one captured
 * clock and one validated zone. Requires the `FastifyRequest` for the same
 * reason `authorizeCloudAsk` does: only a request may hold a read context.
 * `now` is an internal seam for tests and derivations only.
 */
export function mintReadContext(
  request: FastifyRequest,
  db: Db,
  grant: CloudAskGrant,
  tz: string,
  now?: Date,
): ReadContext {
  assertGrant(grant);
  if (request.id === undefined) throw new Error("read context requires a live request");
  return Object.freeze({ db, effectiveNow: now ?? new Date(), tz, grant });
}
