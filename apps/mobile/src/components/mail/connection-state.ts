import type { MailConnection } from "@personal-os/schema";

// Pure, React-free derivation of the mail connection card's state -- the same
// split as `health/connection-state.ts` and `brief/brief-card-state.ts`, and for
// the same reason: the ORDERING below is the whole design, and it is worth
// pinning with tests rather than re-deriving it inside JSX.
//
// THE LOAD-BEARING RULE IS THE FIRST ONE. When the API is unreachable we know
// nothing about the mailbox, and every other state here is a claim about it.
// Falling through to "not connected" on a failed fetch would tell the user their
// Gmail link is gone when in fact the tunnel is down -- the worst available
// answer, because it invites them to reconnect and mint a new grant to fix a
// network problem.

export type MailConnectionDisplayState =
  | "unavailable" // we cannot see the connection, so we assert nothing about it
  | "not_configured" // this server has no Gmail OAuth client at all
  | "not_connected" // configured, but no mailbox has completed consent
  | "needs_reconnect" // needs_reauth or revoked -- syncing has stopped
  | "disconnected" // deliberately disconnected; history retained
  | "error" // active, but a recent sync failed
  | "connected";

export interface ResolveMailConnectionStateInput {
  /** `MailConnectionListResponse.configured` -- server-side OAuth client present. */
  configured: boolean;
  connection: MailConnection | null;
  isLoadError?: boolean;
}

/**
 * Frozen precedence, most-blocking first:
 *
 *   unavailable -> not_configured -> not_connected -> needs_reconnect ->
 *   disconnected -> error -> connected
 *
 * `needs_reconnect` outranks `disconnected` because they are different in the
 * one way that matters to a user: a `needs_reauth` mailbox stopped syncing
 * without being asked, while a `disconnected` one stopped because someone said
 * so. Reporting the first as the second would present a fault as a choice.
 *
 * `error` sits below both because a connection that is erroring but still active
 * is still working -- the engine retries on its own -- whereas everything above
 * needs a human.
 */
export function resolveMailConnectionState(
  input: ResolveMailConnectionStateInput,
): MailConnectionDisplayState {
  const { configured, connection, isLoadError } = input;

  if (isLoadError === true) return "unavailable";
  if (!configured) return "not_configured";
  if (connection === null) return "not_connected";
  if (connection.status === "needs_reauth" || connection.status === "revoked") {
    return "needs_reconnect";
  }
  if (connection.status === "disconnected") return "disconnected";
  if (connection.last_sync_error !== null) return "error";
  return "connected";
}

/**
 * Whether the card should offer a connect/reconnect action in this state.
 *
 * False for `unavailable` specifically, and that is the point: offering
 * "Reconnect" while the API is unreachable invites the user to mint a fresh
 * grant to fix a network problem, which is exactly the confusion the
 * `unavailable` state exists to prevent. False for `not_configured` too --
 * there is no OAuth client for the flow to use, so the button could only ever
 * produce a 409.
 */
export function canConnectMail(state: MailConnectionDisplayState): boolean {
  return state !== "unavailable" && state !== "not_configured";
}

/**
 * Whether the card should offer Disconnect.
 *
 * Only where there is something live to disconnect. An already-disconnected
 * mailbox keeps its row and its history, so offering the action again would do
 * nothing a user could observe.
 */
export function canDisconnectMail(
  state: MailConnectionDisplayState,
  connection: MailConnection | null,
): boolean {
  if (connection === null) return false;
  return state === "connected" || state === "error" || state === "needs_reconnect";
}

/**
 * The most blocking state across EVERY connected mailbox.
 *
 * The card's headline used to be computed from `connections[0]`, and
 * `GET /mail-connections` orders by `created_at` ascending -- so a card listing
 * two mailboxes, one healthy and one needing reauth, was headed "Connected to
 * Gmail." purely because the healthy one was created first. A summary taken from
 * an arbitrary row is not a summary.
 *
 * The ordering below is the same precedence `resolveMailConnectionState` applies
 * within one mailbox, which is what makes the headline and the row it is
 * describing agree.
 */
const SEVERITY: MailConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "disconnected",
  "error",
  "connected",
];

export function resolveOverallMailState(
  input: Omit<ResolveMailConnectionStateInput, "connection"> & {
    connections: MailConnection[];
  },
): MailConnectionDisplayState {
  const { configured, connections, isLoadError } = input;

  // These two are properties of the SERVER, not of any mailbox, so they are
  // answered before the list is consulted at all.
  if (isLoadError === true) return "unavailable";
  if (!configured) return "not_configured";
  if (connections.length === 0) return "not_connected";

  const states = connections.map((connection) =>
    resolveMailConnectionState({ configured, connection, isLoadError }),
  );
  // The worst one wins: a card that says "Connected" while one of its mailboxes
  // has stopped syncing is the failure this replaces.
  for (const candidate of SEVERITY) {
    if (states.includes(candidate)) return candidate;
  }
  return "connected";
}
