import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDevice, revokeDevice } from "./devices.js";

const deviceRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rabbit R1",
  platform: "android",
  push_token: null,
  is_primary_reminder_device: false,
  notifications_enabled: true,
  notify_reminders: false,
  notify_confirmations: true,
  notify_digests: false,
  notify_alerts: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_timezone: null,
  last_seen_at: null,
  revoked_at: null,
  created_at: "2026-08-16T00:00:00.000Z",
};

describe("registerDevice", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("includes the pairing_code field in the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...deviceRow, token: "raw-token-abc" }), { status: 201 }),
      );
    global.fetch = fetchMock;

    const result = await registerDevice("http://localhost:3000", {
      name: "Rabbit R1",
      platform: "android",
      pairing_code: "ABCD-1234",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/devices");
    expect(JSON.parse(init.body as string)).toMatchObject({ pairing_code: "ABCD-1234" });
    expect(result.token).toBe("raw-token-abc");
  });
});

describe("revokeDevice", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends the device token as a Bearer Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(deviceRow), { status: 200 }));
    global.fetch = fetchMock;

    await revokeDevice("http://localhost:3000", "my-device-token", deviceRow.id);

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-device-token",
    );
  });
});
