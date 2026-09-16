import type { CanvasConnection } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  canConnectCanvas,
  canDisconnectCanvas,
  resolveCanvasConnectionState,
  resolveOverallCanvasState,
} from "./connection-state";

// Mirrors mail/connection-state.test.ts's structure closely -- same
// precedence shape, adapted for Canvas's simpler (no reauth/revoked split)
// connection lifecycle.

function connection(overrides: Partial<CanvasConnection> = {}): CanvasConnection {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    canvas_base_url: "https://uta.instructure.com",
    canvas_user_id: 42,
    canvas_user_name: "Jane Doe",
    status: "active",
    last_sync_at: "2026-09-15T12:00:00Z",
    last_sync_error: null,
    last_sync_error_at: null,
    created_at: "2026-09-15T12:00:00Z",
    updated_at: "2026-09-15T12:00:00Z",
    ...overrides,
  };
}

describe("resolveCanvasConnectionState precedence", () => {
  it("returns unavailable on a load error, EVEN with a healthy connection cached", () => {
    // The load-bearing rule. When the API is unreachable we know nothing, and
    // falling through to "not connected" would tell the owner their Canvas
    // link is gone when the tunnel is down -- inviting them to paste a fresh
    // token to fix a network problem.
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection(),
        isLoadError: true,
      }),
    ).toBe("unavailable");
  });

  it("outranks everything else with unavailable", () => {
    expect(
      resolveCanvasConnectionState({ configured: false, connection: null, isLoadError: true }),
    ).toBe("unavailable");
  });

  it("reports not_configured when the server reports no config, even though this never happens live", () => {
    expect(resolveCanvasConnectionState({ configured: false, connection: null })).toBe(
      "not_configured",
    );
  });

  it("reports not_connected when configured but no account has been connected", () => {
    expect(resolveCanvasConnectionState({ configured: true, connection: null })).toBe(
      "not_connected",
    );
  });

  it("reports needs_reconnect for invalid_token", () => {
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection({ status: "invalid_token" }),
      }),
    ).toBe("needs_reconnect");
  });

  it("reports disconnected for a deliberately disconnected account", () => {
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection({ status: "disconnected" }),
      }),
    ).toBe("disconnected");
  });

  it("needs_reconnect outranks disconnected", () => {
    // Both are terminal, but they mean different things to the owner: one
    // stopped without being asked, the other stopped because someone said so.
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection({ status: "invalid_token" }),
      }),
    ).not.toBe("disconnected");
  });

  it("reports error when active but a recent sync failed", () => {
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection({ last_sync_error: "auth_failed" }),
      }),
    ).toBe("error");
  });

  it("error sits below needs_reconnect/disconnected -- an erroring-but-active account is still working", () => {
    expect(
      resolveCanvasConnectionState({
        configured: true,
        connection: connection({ status: "invalid_token", last_sync_error: "auth_failed" }),
      }),
    ).toBe("needs_reconnect");
  });

  it("reports connected for an active account with no error", () => {
    expect(resolveCanvasConnectionState({ configured: true, connection: connection() })).toBe(
      "connected",
    );
  });
});

describe("canConnectCanvas", () => {
  it("is false only for unavailable and not_configured", () => {
    expect(canConnectCanvas("unavailable")).toBe(false);
    expect(canConnectCanvas("not_configured")).toBe(false);
    expect(canConnectCanvas("not_connected")).toBe(true);
    expect(canConnectCanvas("needs_reconnect")).toBe(true);
    expect(canConnectCanvas("disconnected")).toBe(true);
    expect(canConnectCanvas("error")).toBe(true);
    expect(canConnectCanvas("connected")).toBe(true);
  });
});

describe("canDisconnectCanvas", () => {
  it("is false with no connection regardless of state", () => {
    expect(canDisconnectCanvas("connected", null)).toBe(false);
  });

  it("is true only for connected, error, and needs_reconnect", () => {
    const conn = connection();
    expect(canDisconnectCanvas("connected", conn)).toBe(true);
    expect(canDisconnectCanvas("error", conn)).toBe(true);
    expect(canDisconnectCanvas("needs_reconnect", conn)).toBe(true);
    expect(canDisconnectCanvas("disconnected", conn)).toBe(false);
    expect(canDisconnectCanvas("not_connected", conn)).toBe(false);
    expect(canDisconnectCanvas("not_configured", conn)).toBe(false);
    expect(canDisconnectCanvas("unavailable", conn)).toBe(false);
  });
});

describe("resolveOverallCanvasState", () => {
  it("is unavailable/not_configured/not_connected as properties of the server, before consulting the list", () => {
    expect(
      resolveOverallCanvasState({ configured: true, connections: [connection()], isLoadError: true }),
    ).toBe("unavailable");
    expect(resolveOverallCanvasState({ configured: false, connections: [] })).toBe(
      "not_configured",
    );
    expect(resolveOverallCanvasState({ configured: true, connections: [] })).toBe("not_connected");
  });

  it("reports the WORST state across every account, not connections[0]", () => {
    // The healthy one was connected first (created_at ascending), so a
    // summary taken from index 0 would say "Connected" while a second
    // account needs reconnecting.
    const healthy = connection({ id: "a", created_at: "2026-09-01T00:00:00Z" });
    const broken = connection({
      id: "b",
      status: "invalid_token",
      created_at: "2026-09-02T00:00:00Z",
    });
    expect(
      resolveOverallCanvasState({ configured: true, connections: [healthy, broken] }),
    ).toBe("needs_reconnect");
  });

  it("reports connected only when every account is connected", () => {
    const a = connection({ id: "a" });
    const b = connection({ id: "b" });
    expect(resolveOverallCanvasState({ configured: true, connections: [a, b] })).toBe("connected");
  });
});
