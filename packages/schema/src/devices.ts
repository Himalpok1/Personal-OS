import { z } from "zod";
import { booleanQueryParam } from "./pagination.js";

export const DevicePlatformSchema = z.enum(["ios", "android", "web"]);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

// Never includes token_hash or the raw token -- GET/PATCH responses can't
// leak either, mirroring how ai_provider_connections responses structurally
// exclude key material.
export const DeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: DevicePlatformSchema,
  push_token: z.string().nullable(),
  is_primary_reminder_device: z.boolean(),
  notifications_enabled: z.boolean(),
  notify_reminders: z.boolean(),
  notify_confirmations: z.boolean(),
  notify_digests: z.boolean(),
  notify_alerts: z.boolean(),
  quiet_hours_start: z.string().nullable(),
  quiet_hours_end: z.string().nullable(),
  quiet_hours_timezone: z.string().nullable(),
  last_seen_at: z.string().datetime({ offset: true }).nullable(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type Device = z.infer<typeof DeviceSchema>;

// Tailscale-only, no prior device token -- the pairing_code is the actual
// access control (see apps/api/src/routes/devices.ts). .strict() so a
// client can't sneak is_primary_reminder_device/token_hash/etc. into the
// body a new device registers with.
export const DeviceRegisterSchema = z
  .object({
    name: z.string().min(1),
    platform: DevicePlatformSchema,
    pairing_code: z.string().min(1),
  })
  .strict();
export type DeviceRegister = z.infer<typeof DeviceRegisterSchema>;

// The only response shape that ever includes the raw token -- returned
// exactly once, at registration. Never retrievable again by any other
// endpoint.
export const DeviceRegisterResponseSchema = DeviceSchema.extend({
  token: z.string(),
});
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponseSchema>;

// Notification settings + name only -- push_token and
// is_primary_reminder_device change only via their own dedicated action
// endpoints, matching how tasks.ts keeps status transitions out of the
// generic PATCH.
export const DeviceUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    notifications_enabled: z.boolean().optional(),
    notify_reminders: z.boolean().optional(),
    notify_confirmations: z.boolean().optional(),
    notify_digests: z.boolean().optional(),
    notify_alerts: z.boolean().optional(),
    quiet_hours_start: z.string().nullable().optional(),
    quiet_hours_end: z.string().nullable().optional(),
    quiet_hours_timezone: z.string().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type DeviceUpdate = z.infer<typeof DeviceUpdateSchema>;

export const DevicePushTokenSchema = z
  .object({
    push_token: z
      .string()
      .regex(/^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/, "invalid Expo push token"),
  })
  .strict();
export type DevicePushToken = z.infer<typeof DevicePushTokenSchema>;

export const DeviceListQuerySchema = z.object({
  include_revoked: booleanQueryParam(false),
});
export type DeviceListQuery = z.infer<typeof DeviceListQuerySchema>;
