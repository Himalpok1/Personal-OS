import { generateDeviceToken, hashDeviceToken, hashPairingCode } from "@personal-os/core";
import { devicePairingCodes, devices } from "@personal-os/db";
import {
  DeviceListQuerySchema,
  DevicePushTokenSchema,
  DeviceRegisterResponseSchema,
  DeviceRegisterSchema,
  DeviceSchema,
  DeviceUpdateSchema,
} from "@personal-os/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { deviceAuthPreHandler } from "../plugins/device-auth.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

function toDeviceResponse(row: typeof devices.$inferSelect) {
  return DeviceSchema.parse({
    id: row.id,
    name: row.name,
    platform: row.platform,
    push_token: row.pushToken,
    is_primary_reminder_device: row.isPrimaryReminderDevice,
    notifications_enabled: row.notificationsEnabled,
    notify_reminders: row.notifyReminders,
    notify_confirmations: row.notifyConfirmations,
    notify_digests: row.notifyDigests,
    notify_alerts: row.notifyAlerts,
    quiet_hours_start: row.quietHoursStart,
    quiet_hours_end: row.quietHoursEnd,
    quiet_hours_timezone: row.quietHoursTimezone,
    last_seen_at: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  });
}

async function findDevice(app: FastifyInstance, id: string) {
  const [row] = await app.db.select().from(devices).where(eq(devices.id, id));
  return row ?? null;
}

export default function devicesRoutes(app: FastifyInstance): void {
  // Unauthenticated bootstrap context: Tailscale-only, no prior device
  // token exists yet for a brand-new device. Access control here is the
  // pairing code, not a bearer token -- see packages/core/device-auth.ts
  // and apps/api/scripts/generate-pairing-code.ts for why a network
  // endpoint alone (even Tailscale-gated) was insufficient: it's exactly
  // the trust level a revoked-but-still-on-the-tailnet device already has.
  app.post("/devices", async (request, reply) => {
    const body = DeviceRegisterSchema.parse(request.body);

    // Single UPDATE ... WHERE ... RETURNING: "unconsumed and unexpired" is
    // evaluated atomically in one statement, so two concurrent registration
    // attempts against the same code can never both succeed -- whichever
    // wins the row proceeds, the other sees zero rows returned.
    const codeHash = hashPairingCode(body.pairing_code);
    const [consumed] = await app.db
      .update(devicePairingCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(devicePairingCodes.codeHash, codeHash),
          isNull(devicePairingCodes.consumedAt),
          gt(devicePairingCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: devicePairingCodes.id });

    if (!consumed) {
      return reply.code(401).send({ error: "invalid_or_expired_pairing_code" });
    }

    const token = generateDeviceToken();
    const [row] = await app.db
      .insert(devices)
      .values({ name: body.name, platform: body.platform, tokenHash: hashDeviceToken(token) })
      .returning();
    if (!row) throw new Error("insert into devices returned no row");

    return reply.code(201).send(
      DeviceRegisterResponseSchema.parse({
        ...toDeviceResponse(row),
        token,
      }),
    );
  });

  // Everything below requires a valid, unrevoked device token. See
  // plugins/device-auth.ts's security-boundary comment: this token
  // authenticates only this route group, not the rest of the API.
  app.register((authed) => {
    authed.addHook("preHandler", deviceAuthPreHandler);

    authed.get<{ Querystring: Record<string, string> }>("/devices", async (request) => {
      const query = DeviceListQuerySchema.parse(request.query);
      const rows = await app.db
        .select()
        .from(devices)
        .where(query.include_revoked ? undefined : isNull(devices.revokedAt));
      return { items: rows.map(toDeviceResponse) };
    });

    authed.get<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
      const row = await findDevice(app, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return toDeviceResponse(row);
    });

    authed.patch<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
      const body = DeviceUpdateSchema.parse(request.body);
      const existing = await findDevice(app, request.params.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const [row] = await app.db
        .update(devices)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.notifications_enabled !== undefined && {
            notificationsEnabled: body.notifications_enabled,
          }),
          ...(body.notify_reminders !== undefined && { notifyReminders: body.notify_reminders }),
          ...(body.notify_confirmations !== undefined && {
            notifyConfirmations: body.notify_confirmations,
          }),
          ...(body.notify_digests !== undefined && { notifyDigests: body.notify_digests }),
          ...(body.notify_alerts !== undefined && { notifyAlerts: body.notify_alerts }),
          ...(body.quiet_hours_start !== undefined && { quietHoursStart: body.quiet_hours_start }),
          ...(body.quiet_hours_end !== undefined && { quietHoursEnd: body.quiet_hours_end }),
          ...(body.quiet_hours_timezone !== undefined && {
            quietHoursTimezone: body.quiet_hours_timezone,
          }),
        })
        .where(eq(devices.id, request.params.id))
        .returning();
      if (!row) throw new Error("update on devices returned no row for an id that was just found");
      return toDeviceResponse(row);
    });

    // Two-statement transaction: clear the old primary, then set the new
    // one, in that order -- one_primary_device is a non-deferrable partial
    // unique index, so both can never hold true at once mid-transaction if
    // the order were reversed.
    authed.post<{ Params: { id: string } }>("/devices/:id/primary", async (request, reply) => {
      const target = await findDevice(app, request.params.id);
      if (!target) return reply.code(404).send({ error: "not_found" });
      if (target.revokedAt) return reply.code(409).send({ error: "device_revoked" });

      const row = await app.db.transaction(async (tx) => {
        await tx
          .update(devices)
          .set({ isPrimaryReminderDevice: false })
          .where(eq(devices.isPrimaryReminderDevice, true));
        const [updated] = await tx
          .update(devices)
          .set({ isPrimaryReminderDevice: true })
          .where(eq(devices.id, request.params.id))
          .returning();
        return updated;
      });
      if (!row) throw new Error("primary-swap transaction returned no row");
      return toDeviceResponse(row);
    });

    // Self-only: a device can never overwrite another device's push token.
    authed.post<{ Params: { id: string } }>("/devices/:id/push-token", async (request, reply) => {
      if (request.device?.id !== request.params.id) {
        return reply.code(403).send({ error: "forbidden_device_mismatch" });
      }
      const body = DevicePushTokenSchema.parse(request.body);
      const [row] = await app.db
        .update(devices)
        .set({ pushToken: body.push_token })
        .where(eq(devices.id, request.params.id))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return toDeviceResponse(row);
    });

    authed.post<{ Params: { id: string } }>(
      "/devices/:id/test-notification",
      async (request, reply) => {
        if (request.device?.id !== request.params.id) {
          return reply.code(403).send({ error: "forbidden_device_mismatch" });
        }
        const device = await findDevice(app, request.params.id);
        if (!device) return reply.code(404).send({ error: "not_found" });
        if (!device.pushToken) return reply.code(409).send({ error: "push_token_missing" });
        if (!app.bossReady) return reply.code(503).send({ error: "queue_unavailable" });

        const dedupeKey = `test:${device.id}:${Date.now()}`;
        await app.boss.send(NOTIFICATIONS_DISPATCH_QUEUE, {
          category: "alert",
          title: "Personal OS test",
          body: "Remote notifications are configured for this device.",
          data: { test: true },
          dedupeKey,
          deviceId: device.id,
        });
        return reply.code(202).send({ queued: true });
      },
    );

    // Idempotent: revoking an already-revoked device is a no-op, not an
    // error. Does NOT auto-promote a new primary -- no automatic promotion
    // in the MVP, per docs/ARCHITECTURE.md.
    //
    // ===================================================================
    // REVOKING CLEARS is_primary_reminder_device (Checkpoint 8.1, Lane F).
    // ===================================================================
    //
    // It did not before, and `docs/STATUS.md` carried the consequence as debt:
    // "Revoking a device does not clear its `is_primary_reminder_device` flag,
    // so a revoked row can keep holding primary and no device schedules
    // reminders until primary is reassigned."
    //
    // That was a genuinely silent failure. Reminders are scheduled LOCALLY on
    // the primary device only (ADR-020), and a revoked device is not running
    // the app -- so primary stranded on a revoked row means NOTHING schedules
    // anything, with no error anywhere. Worse, the partial unique index
    // `one_primary_device ... WHERE is_primary_reminder_device` meant that
    // stranded flag also BLOCKED promoting a real device until it was cleared.
    //
    // CLEARING IS NOT PROMOTING. ADR-019 and ADR-036 forbid automatic
    // promotion, and this deliberately leaves the system with NO primary rather
    // than choosing one. That is the honest state, and Settings already names
    // it: ADR-036 surfaces "no primary reminder device" as a blocking reason
    // instead of silently scheduling nothing.
    authed.post<{ Params: { id: string } }>("/devices/:id/revoke", async (request, reply) => {
      const existing = await findDevice(app, request.params.id);
      if (!existing) return reply.code(404).send({ error: "not_found" });
      const [row] = await app.db
        .update(devices)
        .set({
          revokedAt: existing.revokedAt ?? new Date(),
          isPrimaryReminderDevice: false,
        })
        .where(eq(devices.id, request.params.id))
        .returning();
      if (!row) throw new Error("update on devices returned no row for an id that was just found");
      return toDeviceResponse(row);
    });
  });
}
