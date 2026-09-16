import { encryptSecret } from "@personal-os/ai-providers";
import {
  CanvasApiError,
  CanvasUrlBlockedError,
  type CanvasClient,
  type CanvasSelfResponse,
} from "@personal-os/canvas-providers";
import {
  CANVAS_USER_NAME_MAX_CHARS,
  truncateProviderString,
} from "@personal-os/core/canvas/provider-strings";
import { canvasConnections, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import { env } from "../env.js";

// The Canvas LMS connection lifecycle (ADR-068, Checkpoint 10.1).
//
// DELIBERATELY SIMPLER than services/mail-connection.ts and
// services/health-connection.ts: those two exist to negotiate an OAuth2
// authorization-code exchange (a redirect, a single-use state, a refresh
// token). Canvas authenticates with a Personal Access Token the owner pastes
// directly into this app -- there is no redirect, no state to consume, and no
// refresh flow to build, because a Canvas PAT is long-lived by default
// (ADR-068 §2). What survives from the mail/health pattern is the part that
// still applies regardless of auth mechanism: verify the credential against
// the real provider BEFORE writing anything, encrypt it with the existing
// AES-256-GCM triple, and make disconnect non-destructive.

export class CanvasAuthFailedError extends Error {
  constructor() {
    // No provider prose: Canvas's own error body is never surfaced (see
    // canvas-client.ts's CanvasApiError, which already destroys it).
    super("Canvas rejected the personal access token");
    this.name = "CanvasAuthFailedError";
  }
}

export class CanvasAlreadyConnectedError extends Error {
  constructor() {
    super("an active connection for this Canvas base URL already exists");
    this.name = "CanvasAlreadyConnectedError";
  }
}

/**
 * A prior (non-active) row exists for this `base_url`, but the freshly
 * authenticated token belongs to a DIFFERENT Canvas user than the one that
 * row was last connected as.
 *
 * Mirrors `services/health-connection.ts`'s `AccountMismatchError` exactly,
 * for the identical structural reason: `canvas_base_url`, like
 * `health_connections`' singleton row, is NOT keyed on the account itself
 * (unlike `mail_connections`, whose `(provider, external_account_id)` key
 * makes a mismatch structurally impossible), so nothing else stops a second
 * person's PAT from silently rebinding this institution's course/assignment
 * history onto a different identity.
 */
export class CanvasAccountMismatchError extends Error {
  constructor() {
    // No identifiers in the message: it reaches a client response.
    super("this Canvas account does not match the existing connection");
    this.name = "CanvasAccountMismatchError";
  }
}

/**
 * The submitted `base_url` (or a redirect it led to) failed
 * `validateCanvasUrl`'s SSRF/cloud-metadata check (packages/canvas-providers/
 * src/ssrf.ts) -- an HTTP scheme, a link-local/metadata IP, or a broadcast
 * address. The rejection reason is this project's own static policy, not
 * anything Canvas said, so unlike `CanvasAuthFailedError` there is no
 * provider-prose risk in naming it -- but the message is still a fixed
 * string here, matching every other route-facing error in this file.
 */
export class CanvasUrlBlockedForConnectError extends Error {
  constructor() {
    super("this Canvas address is not allowed");
    this.name = "CanvasUrlBlockedForConnectError";
  }
}

export type CanvasConnectionRow = typeof canvasConnections.$inferSelect;

/**
 * Strips a single trailing slash so the same institution cannot be stored as
 * two rows differing only by a trailing "/".
 *
 * Mirrors `canvas-client.ts`'s own private `normalizeBaseUrl` exactly.
 * Deliberately duplicated rather than imported/exported across the package
 * boundary -- this project's standing convention is near-duplication per
 * provider over a shared generic module (ADR-052's stated reasoning), and a
 * two-line pure function is exactly the shape that convention is written
 * for.
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Reads the pg error `code`/`constraint` off either the error itself or its
 * `cause`, mirroring `routes/events.ts`'s `pgErrorField` exactly -- the same
 * helper this codebase already uses to distinguish "this specific unique
 * index fired" from "some other database error happened to be a 23505".
 */
function pgErrorField(err: unknown, field: "code" | "constraint"): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as Record<string, unknown>)[field];
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeValue = (cause as Record<string, unknown>)[field];
    if (typeof causeValue === "string") return causeValue;
  }
  return undefined;
}

/** True only for a unique violation on `canvas_connections_base_url_unique`. */
function isBaseUrlConflict(err: unknown): boolean {
  return (
    pgErrorField(err, "code") === "23505" &&
    pgErrorField(err, "constraint") === "canvas_connections_base_url_unique"
  );
}

/**
 * Picks the display name to store from `GET /users/self`.
 *
 * `short_name` first (the name Canvas shows the owner day-to-day in its own
 * UI), falling back to `name` -- the two fields ADR-068 names as ever
 * consumed downstream, alongside `id`. Bounded at write with
 * `truncateProviderString`/`CANVAS_USER_NAME_MAX_CHARS`
 * (`packages/core/src/canvas/provider-strings.ts`), never rejected: a person
 * did not type this, Canvas did.
 */
function displayName(self: CanvasSelfResponse): string | null {
  const raw =
    typeof self.short_name === "string"
      ? self.short_name
      : typeof self.name === "string"
        ? self.name
        : null;
  return truncateProviderString(raw, CANVAS_USER_NAME_MAX_CHARS);
}

function toNumericId(id: number | string): number | null {
  const parsed = typeof id === "number" ? id : Number(id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface ConnectCanvasConnectionParams {
  db: Db;
  client: CanvasClient;
  baseUrl: string;
  token: string;
  now?: Date;
}

export interface ConnectCanvasConnectionResult {
  connection: CanvasConnectionRow;
  /** False when this call REACTIVATED a prior disconnected/invalid_token row. */
  created: boolean;
}

/**
 * Verifies the token against the real Canvas instance, then persists the
 * connection. Both the route's direct entry point and (if one is ever added)
 * any other caller go through this single function.
 *
 * ORDER IS DEFENSIVE, mirroring `completeGmailConnection`/
 * `completeHealthConnection`'s own documented ordering: `getSelf` runs
 * BEFORE anything is written, so a bad or revoked token never reaches the
 * database as an `active` row -- "nothing is written until identity is
 * verified" applies here exactly as it does to an OAuth grant, even though
 * there is no code/state exchange to guard first.
 *
 * RECONNECT-AFTER-DISCONNECT (Checkpoint 10.1C, found live in production
 * 10.1B): `canvas_base_url` is the identity -- one Canvas installation per
 * connection row, ever, the same as `mail_connections`'
 * `(provider, external_account_id)` and `health_connections`'
 * `health_user_id`. The original implementation enforced that identity by
 * attempting a blind INSERT and catching the database's own unique
 * violation ("let the constraint be the truth", `routes/events.ts`'s
 * `client_uuid` approach) -- correct for preventing two SIMULTANEOUS rows,
 * but it could not distinguish "a row already exists and is active" from "a
 * row already exists but was disconnected", so disconnecting Canvas made
 * reconnecting to the SAME institution permanently 409 until someone deleted
 * the row by hand. `completeGmailConnection`/`completeHealthConnection` never
 * had this bug because they SELECT the prior row by identity first and
 * UPDATE it in place -- that is the established Personal OS reconnect
 * pattern, and this function now follows it: a prior ACTIVE row still
 * refuses (`CanvasAlreadyConnectedError` -- unlike Gmail/Health, a PAT paste
 * is one deliberate manual action, not an OAuth popup that can legitimately
 * re-fire mid-session, so silently swapping a live connection's credentials
 * without an explicit disconnect first would be surprising); a prior
 * disconnected/invalid_token row is REACTIVATED in place, preserving its id,
 * `created_at`, and every synced course/assignment/announcement/event row
 * (`ON DELETE CASCADE` is on the FK, never triggered by an UPDATE) rather
 * than losing that history to a delete-and-recreate. A genuine identity
 * conflict -- a different Canvas user reconnecting at the same base URL --
 * is refused by `CanvasAccountMismatchError` rather than silently rebound,
 * mirroring `completeHealthConnection`'s identical guard. The INSERT path
 * (no prior row at all) keeps its unique-violation catch as a defense-in-
 * depth backstop for the SELECT-then-write race window this introduces --
 * the same race Gmail/Health's identical pattern already accepts, since two
 * concurrent connects to the same institution is not a realistic scenario
 * for a single-user app behind Tailscale.
 */
export async function connectCanvasConnection(
  params: ConnectCanvasConnectionParams,
): Promise<ConnectCanvasConnectionResult> {
  const now = params.now ?? new Date();
  const baseUrl = normalizeBaseUrl(params.baseUrl);

  let self: CanvasSelfResponse;
  try {
    self = await params.client.getSelf(baseUrl, params.token);
  } catch (err) {
    if (err instanceof CanvasApiError) throw new CanvasAuthFailedError();
    if (err instanceof CanvasUrlBlockedError) throw new CanvasUrlBlockedForConnectError();
    throw err;
  }

  const canvasUserId = toNumericId(self.id);
  if (canvasUserId === null) {
    // Canvas answered but with no usable numeric id -- treat exactly like an
    // auth failure rather than persisting a connection with a garbage id.
    throw new CanvasAuthFailedError();
  }

  const [prior] = await params.db
    .select()
    .from(canvasConnections)
    .where(eq(canvasConnections.canvasBaseUrl, baseUrl))
    .limit(1);

  if (prior && prior.status === "active") {
    throw new CanvasAlreadyConnectedError();
  }
  if (prior && prior.canvasUserId !== canvasUserId) {
    throw new CanvasAccountMismatchError();
  }

  const secret = encryptSecret(params.token, env.CREDENTIALS_ENCRYPTION_KEY);
  const values = {
    canvasBaseUrl: baseUrl,
    canvasUserId,
    canvasUserName: displayName(self),
    accessTokenCiphertext: secret.ciphertext,
    accessTokenIv: secret.iv,
    accessTokenAuthTag: secret.authTag,
    status: "active" as const,
    // A successful (re)connect clears whatever failure sent the owner here.
    lastSyncError: null,
    lastSyncErrorAt: null,
    updatedAt: now,
  };

  if (prior) {
    const [row] = await params.db
      .update(canvasConnections)
      .set(values)
      .where(eq(canvasConnections.id, prior.id))
      .returning();
    return { connection: row!, created: false };
  }

  try {
    const [row] = await params.db
      .insert(canvasConnections)
      .values({ ...values, createdAt: now })
      .returning();
    return { connection: row!, created: true };
  } catch (err) {
    if (isBaseUrlConflict(err)) throw new CanvasAlreadyConnectedError();
    throw err;
  }
}

/**
 * Marks a connection disconnected and clears its credential. Idempotent:
 * disconnecting an already-disconnected row just re-writes the same status
 * (the three token columns are already null by then).
 *
 * Mirrors `disconnectGmailConnection`/`disconnectHealthConnection`: a
 * disconnected connection retains no usable credential at all, not merely an
 * unread one gated by `status`. `packages/db/src/schema/canvas-connections.ts`
 * enforces this as a real invariant, not just an application convention --
 * `canvas_connections_access_token_triple` requires the three columns to be
 * all-null or all-non-null, the same triple-null-or-all CHECK
 * `mail_connections` uses.
 *
 * There is no remote revocation call to make here, unlike Gmail/Health:
 * Canvas exposes no "delete this token" endpoint reachable without the
 * token's own internal numeric id, which this integration never fetches or
 * stores (ADR-068 §3's narrower-than-Canvas storage) -- the owner revokes the
 * PAT itself from their own Canvas account settings if they want it dead
 * server-side too. All synced course/assignment/announcement/event rows are
 * left completely untouched -- they remain a read-only historical cache,
 * exactly as ADR-068 intends, and the `ON DELETE CASCADE` foreign keys on
 * those tables are never triggered by a disconnect (only by deleting the
 * connection row outright, which no route in this checkpoint does).
 */
export async function disconnectCanvasConnection(
  db: Db,
  connection: CanvasConnectionRow,
  now: Date = new Date(),
): Promise<CanvasConnectionRow> {
  const [row] = await db
    .update(canvasConnections)
    .set({
      status: "disconnected",
      accessTokenCiphertext: null,
      accessTokenIv: null,
      accessTokenAuthTag: null,
      updatedAt: now,
    })
    .where(eq(canvasConnections.id, connection.id))
    .returning();
  return row!;
}
