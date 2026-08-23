import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import * as schema from "./schema/index.js";

// -----------------------------------------------------------------------
// pg `date` (oid 1082) / `date[]` (oid 1182) identity type-parser fix
// -----------------------------------------------------------------------
//
// THE BUG (confirmed empirically against a real Postgres instance -- see
// the Checkpoint 5.5 audit script that reproduced this against the test
// database before this fix was written):
//
// By default, `pg` (via its `pg-types` -> `postgres-date` dependency chain)
// parses a `date`-typed column into a JS `Date` built with the
// *process-local* timezone: `new Date(year, month, day)`. Drizzle's
// string-mode `date()` column (`PgDateString`, used throughout this
// schema -- `events.start_date`/`end_date`/`recurrence_exdates`,
// `tasks.recurrence_exdates`, `reviews.period_start`,
// `projects.target_date`, `ai_daily_briefs.brief_date`) then converts that
// `Date` back into a string via `value.toISOString().slice(0, -14)`, which
// reads the date in **UTC**, not the process-local zone the `Date` was
// constructed in.
//
// Those two steps disagree whenever the process's OS timezone has a
// *positive* UTC offset: local midnight for a given calendar date falls on
// the *previous* UTC calendar day, so the round-tripped string is silently
// one calendar day earlier than what was actually stored. A zero or
// negative offset (UTC itself, America/Chicago, ...) happens not to
// trigger it, which is exactly why this stayed latent -- this app has so
// far only ever run as UTC (a `node:22-alpine` default, not a guarantee)
// or from a Chicago-based dev machine.
//
// Empirically reproduced against a real Postgres (a date column storing
// '2026-08-22', read back through this exact `pg` -> Drizzle path):
//
//   TZ=UTC             -> '2026-08-22' (correct)
//   TZ=America/Chicago -> '2026-08-22' (correct)
//   TZ=Asia/Kolkata     -> '2026-08-21' (WRONG -- one day early)
//   TZ=Australia/Sydney -> '2026-08-21' (WRONG -- one day early)
//
// It is silent: 'YYYY-MM-DD' remains a syntactically valid date string, so
// no Zod schema and no exception ever surfaces the corruption.
//
// THE FIX:
//
// Drizzle's string-mode date column already expects, and per its own
// `mapFromDriverValue` prefers, a raw 'YYYY-MM-DD' string -- it only falls
// into the broken `Date`-round-trip path because `pg` hands it a `Date`
// object instead of the string it received on the wire. Registering an
// *identity* type parser for oid 1082 makes `pg` return that raw wire
// string unchanged, so Drizzle's `typeof value === 'string'` branch is
// taken directly and no timezone conversion of any kind ever happens. This
// is correct in every process timezone, not just non-positive-offset ones.
//
// `date[]` columns (oid 1182, Postgres builtin `_date` -- confirmed via
// `SELECT oid FROM pg_type WHERE typname = '_date'`) have the identical
// defect one layer down: `pg-types`' `parseDateArray` parses every element
// with the same broken date parser, independent of whatever scalar parser
// is registered for oid 1082 (it calls the parser function directly rather
// than delegating through the type-parser registry), so it needs its own
// identity parser. Postgres's wire format for a `date[]` is a
// brace-delimited, comma-separated list of unquoted 'YYYY-MM-DD' entries
// (or the literal `NULL`) -- e.g. '{2026-08-22,2025-01-01,NULL}', confirmed
// directly against a live server -- so a plain split is exact here; unlike
// a general-purpose array parser this deliberately does not attempt to
// handle quoting/escaping, because a calendar date can never contain a
// character that would require it.
//
// This registration is a side effect of importing this module, and must
// run before any `Pool` (and therefore any real connection) is created:
// `pg`'s type-parser registry (`pg.types`) is a single table shared by
// every `Client`/`Pool` in the process, so it only needs to happen once.
types.setTypeParser(types.builtins.DATE, (value) => value);
// `@types/pg`'s `TypeId` enum (re-exported from `pg-types`) only lists
// scalar builtin oids -- 1182 (`_date`, the array variant of 1082) has no
// enum member even though it is exactly as real and stable an oid. The
// `as never` cast exists solely to bridge that gap in the upstream type
// declarations; the value is empirically confirmed above.
types.setTypeParser(1182 as never, parsePgDateArrayIdentity);

/**
 * Parses a Postgres `date[]` (oid 1182) wire-format string into an array of
 * raw 'YYYY-MM-DD' strings (or `null` for SQL NULL entries), with no
 * `Date`-object round-trip. Exported only so the regression test in
 * `packages/db/test` can exercise it directly without a live database.
 */
export function parsePgDateArrayIdentity(value: string): Array<string | null> {
  const inner = value.slice(1, -1); // strip the enclosing '{' and '}'
  if (inner.length === 0) return [];
  return inner.split(",").map((entry) => (entry === "NULL" ? null : entry));
}

// Lazy: does not connect at import time. apps/api relies on this so it can
// boot and serve /health even when Postgres is unreachable. A short
// connectionTimeoutMillis keeps a down database from hanging /health forever.
export function createDbClient(connectionString: string) {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDbClient>;
