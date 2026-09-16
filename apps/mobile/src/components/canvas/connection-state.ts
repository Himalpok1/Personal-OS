import type { CanvasConnection } from "@personal-os/schema";

// Pure, React-free derivation of the Canvas connection card's state -- the
// same split as `mail/connection-state.ts` and `health/connection-state.ts`,
// and for the same reason: the ORDERING below is the whole design, and it is
// worth pinning with tests rather than re-deriving it inside JSX.
//
// THE LOAD-BEARING RULE IS THE FIRST ONE, unchanged from mail's. When the API
// is unreachable we know nothing about the connection, and every other state
// here is a claim about it. Falling through to "not connected" on a failed
// fetch would tell the owner their Canvas link is gone when in fact the
// tunnel is down -- the worst available answer, because it invites them to
// paste a fresh token to fix a network problem.
//
// Canvas's own connection lifecycle (`packages/schema/src/canvas.ts`,
// `CanvasConnectionStatusSchema`) is `active | disconnected | invalid_token`
// -- deliberately no `needs_reauth` distinct from a hard failure the way
// mail's OAuth model has one, because a Personal Access Token has no
// partially-connected middle state: ADR-068 §2, "Canvas either accepts the
// token or it does not."

export type CanvasConnectionDisplayState =
  | "unavailable" // we cannot see the connection, so we assert nothing about it
  | "not_configured" // wire-shape parity only -- see the note below
  | "not_connected" // configured, but no Canvas account has been connected
  | "needs_reconnect" // invalid_token -- Canvas rejected the stored access token
  | "disconnected" // deliberately disconnected; synced history retained
  | "error" // active, but a recent sync failed
  | "connected";

export interface ResolveCanvasConnectionStateInput {
  /**
   * `CanvasConnectionsListResponse.configured`. Unlike mail/health, Canvas
   * needs no server-side OAuth client at all -- `apps/api/src/routes/
   * canvas-connections.ts` hardcodes this `true` and says so ("this server
   * can always attempt a connection"), so `not_configured` is structurally
   * unreachable through the real API today. It is still modelled here,
   * exactly like `resolveMailConnectionState`'s `configured` input, because
   * the wire schema carries a genuine `boolean` rather than a literal `true`,
   * and a state resolver should not assume a property of today's one server
   * build into its own type.
   */
  configured: boolean;
  connection: CanvasConnection | null;
  isLoadError?: boolean;
}

/**
 * Frozen precedence, most-blocking first -- the same shape
 * `resolveMailConnectionState` uses, minus the reauth/revoked split mail's
 * OAuth model needs and Canvas's Personal-Access-Token model does not.
 *
 *   unavailable -> not_configured -> not_connected -> needs_reconnect ->
 *   disconnected -> error -> connected
 */
export function resolveCanvasConnectionState(
  input: ResolveCanvasConnectionStateInput,
): CanvasConnectionDisplayState {
  const { configured, connection, isLoadError } = input;

  if (isLoadError === true) return "unavailable";
  if (!configured) return "not_configured";
  if (connection === null) return "not_connected";
  if (connection.status === "invalid_token") return "needs_reconnect";
  if (connection.status === "disconnected") return "disconnected";
  if (connection.last_sync_error !== null) return "error";
  return "connected";
}

/**
 * Whether the card should offer a connect/reconnect action in this state.
 *
 * False for `unavailable` specifically: offering "Connect" while the API is
 * unreachable invites the owner to paste a fresh token to fix a network
 * problem, exactly the confusion `unavailable` exists to prevent. False for
 * `not_configured` too, for parity with mail -- there is no server-side
 * config for the action to use, even though this branch is unreached today.
 */
export function canConnectCanvas(state: CanvasConnectionDisplayState): boolean {
  return state !== "unavailable" && state !== "not_configured";
}

/**
 * Whether the card should offer Disconnect.
 *
 * Only where there is something live to disconnect. An already-disconnected
 * Canvas account keeps its row and its synced course/assignment history, so
 * offering the action again would do nothing a user could observe.
 */
export function canDisconnectCanvas(
  state: CanvasConnectionDisplayState,
  connection: CanvasConnection | null,
): boolean {
  if (connection === null) return false;
  return state === "connected" || state === "error" || state === "needs_reconnect";
}

/**
 * The most blocking state across EVERY connected Canvas account.
 *
 * `GET /canvas-connections` orders by `created_at` ascending (mirroring
 * `GET /mail-connections`), so a summary taken from `connections[0]` would
 * let the account connected first speak for a card that may also hold a
 * broken one. The ordering below is the same precedence
 * `resolveCanvasConnectionState` applies within one account, which is what
 * keeps the headline and the row it describes in agreement.
 */
const SEVERITY: CanvasConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "disconnected",
  "error",
  "connected",
];

export function resolveOverallCanvasState(
  input: Omit<ResolveCanvasConnectionStateInput, "connection"> & {
    connections: CanvasConnection[];
  },
): CanvasConnectionDisplayState {
  const { configured, connections, isLoadError } = input;

  // Properties of the SERVER, not of any one account, so they are answered
  // before the list is consulted at all.
  if (isLoadError === true) return "unavailable";
  if (!configured) return "not_configured";
  if (connections.length === 0) return "not_connected";

  const states = connections.map((connection) =>
    resolveCanvasConnectionState({ configured, connection, isLoadError }),
  );
  // The worst one wins: a card that says "Connected" while one account has
  // stopped syncing is the failure this replaces.
  for (const candidate of SEVERITY) {
    if (states.includes(candidate)) return candidate;
  }
  return "connected";
}
