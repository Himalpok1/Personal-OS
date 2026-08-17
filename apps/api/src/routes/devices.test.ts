import { generatePairingCode, hashPairingCode } from "@personal-os/core";
import { devicePairingCodes } from "@personal-os/db";
import type { Device, DeviceRegisterResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

async function insertPairingCode(app: FastifyInstance, expiresInMs: number): Promise<string> {
  const code = generatePairingCode();
  await app.db
    .insert(devicePairingCodes)
    .values({ codeHash: hashPairingCode(code), expiresAt: new Date(Date.now() + expiresInMs) });
  return code;
}

async function registerDevice(app: FastifyInstance, pairingCode: string, name = "Test device") {
  return app.inject({
    method: "POST",
    url: "/devices",
    payload: { name, platform: "android", pairing_code: pairingCode },
  });
}

describe("devices routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await truncateTestTables(app);
  });

  describe("POST /devices (pairing-gated registration)", () => {
    it("rejects registration with no pairing_code field at all", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/devices",
        payload: { name: "x", platform: "android" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("rejects registration with an unknown pairing code", async () => {
      const response = await registerDevice(app, "NOPE-0000");
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("invalid_or_expired_pairing_code");
    });

    it("rejects registration with an expired pairing code", async () => {
      const code = await insertPairingCode(app, -1000);
      const response = await registerDevice(app, code);
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("invalid_or_expired_pairing_code");
    });

    it("registers a device, returning the raw token exactly once", async () => {
      const code = await insertPairingCode(app, 15 * 60_000);
      const response = await registerDevice(app, code, "Rabbit R1");
      expect(response.statusCode).toBe(201);
      const body = response.json<DeviceRegisterResponse>();
      expect(body.name).toBe("Rabbit R1");
      expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(body.is_primary_reminder_device).toBe(false);
    });

    it("consumes the code atomically -- a second registration with the same code fails", async () => {
      const code = await insertPairingCode(app, 15 * 60_000);
      const first = await registerDevice(app, code);
      expect(first.statusCode).toBe(201);

      const second = await registerDevice(app, code);
      expect(second.statusCode).toBe(401);
      expect(second.json<ErrorBody>().error).toBe("invalid_or_expired_pairing_code");
    });

    it("exactly one of two concurrent registration attempts with the same code succeeds", async () => {
      const code = await insertPairingCode(app, 15 * 60_000);
      const [a, b] = await Promise.all([registerDevice(app, code), registerDevice(app, code)]);
      const statuses = [a.statusCode, b.statusCode].sort();
      expect(statuses).toEqual([201, 401]);
    });
  });

  describe("authenticated device routes", () => {
    async function registerAndGetToken(
      app: FastifyInstance,
      name = "Device",
    ): Promise<{
      token: string;
      device: DeviceRegisterResponse;
    }> {
      const code = await insertPairingCode(app, 15 * 60_000);
      const response = await registerDevice(app, code, name);
      const device = response.json<DeviceRegisterResponse>();
      return { token: device.token, device };
    }

    it("rejects a request with no Authorization header", async () => {
      const response = await app.inject({ method: "GET", url: "/devices" });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("unauthorized");
    });

    it("rejects a request with an unknown token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/devices",
        headers: { authorization: "Bearer not-a-real-token" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("invalid_token");
    });

    it("rejects a request from a revoked device's token", async () => {
      const { token, device } = await registerAndGetToken(app);
      await app.inject({
        method: "POST",
        url: `/devices/${device.id}/revoke`,
        headers: { authorization: `Bearer ${token}` },
      });

      const response = await app.inject({
        method: "GET",
        url: "/devices",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorBody>().error).toBe("device_revoked");
    });

    it("accepts a valid token and lists devices, excluding revoked ones by default", async () => {
      const { token, device } = await registerAndGetToken(app);
      const { device: device2 } = await registerAndGetToken(app, "Second device");
      await app.inject({
        method: "POST",
        url: `/devices/${device2.id}/revoke`,
        headers: { authorization: `Bearer ${token}` },
      });

      const response = await app.inject({
        method: "GET",
        url: "/devices",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: Device[] }>();
      expect(body.items.map((d) => d.id)).toEqual([device.id]);

      const withRevoked = await app.inject({
        method: "GET",
        url: "/devices?include_revoked=true",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(withRevoked.json<{ items: Device[] }>().items).toHaveLength(2);
    });

    it("primary-swap: exactly one device is primary after two swaps", async () => {
      const { token, device: deviceA } = await registerAndGetToken(app, "A");
      const { device: deviceB } = await registerAndGetToken(app, "B");

      const first = await app.inject({
        method: "POST",
        url: `/devices/${deviceA.id}/primary`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(first.json<Device>().is_primary_reminder_device).toBe(true);

      const second = await app.inject({
        method: "POST",
        url: `/devices/${deviceB.id}/primary`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.json<Device>().is_primary_reminder_device).toBe(true);

      const list = await app.inject({
        method: "GET",
        url: "/devices",
        headers: { authorization: `Bearer ${token}` },
      });
      const primaries = list
        .json<{ items: Device[] }>()
        .items.filter((d) => d.is_primary_reminder_device);
      expect(primaries).toHaveLength(1);
      expect(primaries[0]?.id).toBe(deviceB.id);
    });

    it("push-token: a device can update its own token but not another device's", async () => {
      const { token: tokenA, device: deviceA } = await registerAndGetToken(app, "A");
      const { device: deviceB } = await registerAndGetToken(app, "B");

      const own = await app.inject({
        method: "POST",
        url: `/devices/${deviceA.id}/push-token`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { push_token: "ExponentPushToken[abc]" },
      });
      expect(own.statusCode).toBe(200);
      expect(own.json<Device>().push_token).toBe("ExponentPushToken[abc]");

      const other = await app.inject({
        method: "POST",
        url: `/devices/${deviceB.id}/push-token`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { push_token: "ExponentPushToken[hijack]" },
      });
      expect(other.statusCode).toBe(403);
      expect(other.json<ErrorBody>().error).toBe("forbidden_device_mismatch");
    });

    it("test-notification targets the authenticated device after token registration", async () => {
      const { token, device } = await registerAndGetToken(app, "Rabbit R1");
      await app.inject({
        method: "POST",
        url: `/devices/${device.id}/push-token`,
        headers: { authorization: `Bearer ${token}` },
        payload: { push_token: "ExponentPushToken[abc]" },
      });
      const sendSpy = vi.spyOn(app.boss, "send").mockResolvedValue("notification-job");

      const response = await app.inject({
        method: "POST",
        url: `/devices/${device.id}/test-notification`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(202);
      expect(sendSpy).toHaveBeenCalledWith(
        "notifications.dispatch",
        expect.objectContaining({ category: "alert", deviceId: device.id }),
      );
    });

    it("test-notification rejects another device and a device without a push token", async () => {
      const { token, device } = await registerAndGetToken(app, "A");
      const { device: other } = await registerAndGetToken(app, "B");

      const missing = await app.inject({
        method: "POST",
        url: `/devices/${device.id}/test-notification`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(missing.statusCode).toBe(409);

      const forbidden = await app.inject({
        method: "POST",
        url: `/devices/${other.id}/test-notification`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it("revoke is idempotent", async () => {
      const { token, device } = await registerAndGetToken(app);
      const first = await app.inject({
        method: "POST",
        url: `/devices/${device.id}/revoke`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<Device>().revoked_at).not.toBeNull();

      // Second revoke can't use the now-revoked token to authenticate, but
      // a fresh registration's token can still hit the same already-revoked
      // target and confirm the call is a harmless no-op, not an error.
      const { token: otherToken } = await registerAndGetToken(app, "Other");
      const second = await app.inject({
        method: "POST",
        url: `/devices/${device.id}/revoke`,
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(second.statusCode).toBe(200);
    });

    it("revoking a device does not affect the tasks/capture endpoints -- the security boundary is scoped", async () => {
      const { token, device } = await registerAndGetToken(app);
      await app.inject({
        method: "POST",
        url: `/devices/${device.id}/revoke`,
        headers: { authorization: `Bearer ${token}` },
      });

      // /tasks was never gated by a device token in the first place --
      // Tailscale-only, unchanged from Phase 2. No Authorization header at
      // all is required or even meaningful here.
      const response = await app.inject({
        method: "GET",
        url: "/tasks",
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
