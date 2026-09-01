import type { MailConnection } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  canConnectMail,
  canDisconnectMail,
  resolveMailConnectionState,
  resolveOverallMailState,
} from "./connection-state";

function connection(overrides: Partial<MailConnection> = {}): MailConnection {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "gmail",
    external_account_id: "person@example.com",
    status: "active",
    granted_scope: "https://www.googleapis.com/auth/gmail.metadata",
    identity_verified_at: "2026-08-31T12:00:00Z",
    last_sync_error: null,
    last_sync_error_at: null,
    created_at: "2026-08-31T12:00:00Z",
    updated_at: "2026-08-31T12:00:00Z",
    ...overrides,
  };
}

describe("resolveMailConnectionState precedence", () => {
  it("returns unavailable on a load error, EVEN with a healthy connection cached", () => {
    // The load-bearing rule. When the API is unreachable we know nothing, and
    // falling through to "not connected" would tell the user their Gmail link is
    // gone when the tunnel is down -- inviting them to mint a new grant to fix a
    // network problem.
    expect(
      resolveMailConnectionState({
        configured: true,
        connection: connection(),
        isLoadError: true,
      }),
    ).toBe("unavailable");
  });

  it("outranks everything else with unavailable", () => {
    expect(
      resolveMailConnectionState({ configured: false, connection: null, isLoadError: true }),
    ).toBe("unavailable");
  });

  it("reports not_configured when the server has no OAuth client", () => {
    expect(resolveMailConnectionState({ configured: false, connection: null })).toBe(
      "not_configured",
    );
  });

  it("reports not_connected when configured but nobody has consented", () => {
    expect(resolveMailConnectionState({ configured: true, connection: null })).toBe(
      "not_connected",
    );
  });

  it("reports needs_reconnect for needs_reauth AND revoked", () => {
    for (const status of ["needs_reauth", "revoked"] as const) {
      expect(
        resolveMailConnectionState({ configured: true, connection: connection({ status }) }),
      ).toBe("needs_reconnect");
    }
  });

  it("keeps needs_reconnect ABOVE disconnected", () => {
    // They differ in the one way that matters: a needs_reauth mailbox stopped
    // syncing without being asked; a disconnected one stopped because somebody
    // said so. Reporting a fault as a choice would be wrong.
    expect(
      resolveMailConnectionState({
        configured: true,
        connection: connection({ status: "needs_reauth", last_sync_error: "auth_expired" }),
      }),
    ).toBe("needs_reconnect");
  });

  it("reports disconnected distinctly from not_connected", () => {
    // "Never connected" and "deliberately disconnected, history retained" are
    // different situations needing different words.
    expect(
      resolveMailConnectionState({
        configured: true,
        connection: connection({ status: "disconnected" }),
      }),
    ).toBe("disconnected");
  });

  it("reports error for an ACTIVE connection whose last sync failed", () => {
    expect(
      resolveMailConnectionState({
        configured: true,
        connection: connection({ last_sync_error: "rate_limited" }),
      }),
    ).toBe("error");
  });

  it("reports connected when nothing is wrong", () => {
    expect(resolveMailConnectionState({ configured: true, connection: connection() })).toBe(
      "connected",
    );
  });
});

describe("canConnectMail", () => {
  it("withholds the action while UNAVAILABLE", () => {
    // Offering "Reconnect" when the API is unreachable invites the user to mint
    // a fresh grant to fix a network problem -- the exact confusion the
    // unavailable state exists to prevent.
    expect(canConnectMail("unavailable")).toBe(false);
  });

  it("withholds the action when the server has no OAuth client", () => {
    // The button could only ever produce a 409.
    expect(canConnectMail("not_configured")).toBe(false);
  });

  it("offers the action in every state a consent flow could actually fix", () => {
    for (const state of ["not_connected", "needs_reconnect", "disconnected", "error", "connected"] as const) {
      expect(canConnectMail(state), state).toBe(true);
    }
  });
});

describe("canDisconnectMail", () => {
  it("is false with no connection at all", () => {
    expect(canDisconnectMail("not_connected", null)).toBe(false);
  });

  it("is false for an already-disconnected mailbox", () => {
    // The row and its history are retained, so the action would do nothing the
    // user could observe.
    expect(canDisconnectMail("disconnected", connection({ status: "disconnected" }))).toBe(false);
  });

  it("is true wherever there is something live to disconnect", () => {
    expect(canDisconnectMail("connected", connection())).toBe(true);
    expect(canDisconnectMail("error", connection({ last_sync_error: "rate_limited" }))).toBe(true);
    // Including needs_reconnect: the credentials are dead but the row is not,
    // and a user may want to clear it rather than re-grant.
    expect(canDisconnectMail("needs_reconnect", connection({ status: "needs_reauth" }))).toBe(true);
  });

  it("is false while unavailable, whatever is cached", () => {
    expect(canDisconnectMail("unavailable", connection())).toBe(false);
  });
});

describe("resolveOverallMailState — corrections found by the audit", () => {
  // The headline used to be computed from `connections[0]`, and the list is
  // ordered by created_at -- so the OLDEST mailbox spoke for the whole card.

  it("reports the WORST mailbox, not the first one", () => {
    const healthy = connection({ id: "aaaaaaaa-1111-4111-8111-111111111111" });
    const broken = connection({
      id: "bbbbbbbb-2222-4222-8222-222222222222",
      status: "needs_reauth",
    });
    // Healthy first, exactly as created_at ordering would deliver it.
    expect(
      resolveOverallMailState({ configured: true, connections: [healthy, broken] }),
    ).toBe("needs_reconnect");
  });

  it("is order-independent", () => {
    const healthy = connection();
    const broken = connection({ status: "needs_reauth" });
    expect(resolveOverallMailState({ configured: true, connections: [healthy, broken] })).toBe(
      resolveOverallMailState({ configured: true, connections: [broken, healthy] }),
    );
  });

  it("still says connected when every mailbox is fine", () => {
    expect(
      resolveOverallMailState({ configured: true, connections: [connection(), connection()] }),
    ).toBe("connected");
  });

  it("answers the SERVER-level states before consulting any mailbox", () => {
    // A load error or missing credentials are facts about the server, so a
    // cached mailbox list must not override them.
    expect(
      resolveOverallMailState({ configured: true, connections: [connection()], isLoadError: true }),
    ).toBe("unavailable");
    expect(resolveOverallMailState({ configured: false, connections: [connection()] })).toBe(
      "not_configured",
    );
  });

  it("reports not_connected for an empty list", () => {
    expect(resolveOverallMailState({ configured: true, connections: [] })).toBe("not_connected");
  });

  it("prefers a sync error over connected, but a reconnect over both", () => {
    const erroring = connection({ last_sync_error: "rate_limited" });
    expect(resolveOverallMailState({ configured: true, connections: [connection(), erroring] })).toBe(
      "error",
    );
    expect(
      resolveOverallMailState({
        configured: true,
        connections: [erroring, connection({ status: "needs_reauth" })],
      }),
    ).toBe("needs_reconnect");
  });
});
