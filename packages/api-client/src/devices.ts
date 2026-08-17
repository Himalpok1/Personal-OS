import {
  DeviceRegisterResponseSchema,
  DeviceRegisterSchema,
  DeviceSchema,
  DeviceUpdateSchema,
  type Device,
  type DeviceRegister,
  type DeviceRegisterResponse,
  type DevicePushToken,
  type DeviceUpdate,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

const DeviceListResponseSchema = z.object({ items: z.array(DeviceSchema) });
const TestNotificationResponseSchema = z.object({ queued: z.literal(true) });

export interface DeviceListParams {
  include_revoked?: boolean;
}

export async function registerDevice(
  baseUrl: string,
  body: DeviceRegister,
): Promise<DeviceRegisterResponse> {
  const parsed = DeviceRegisterSchema.parse(body);
  return fetchJson(baseUrl, "/devices", DeviceRegisterResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function listDevices(baseUrl: string, token: string, params: DeviceListParams = {}) {
  return fetchJson(baseUrl, `/devices${buildQuery(params)}`, DeviceListResponseSchema, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getDevice(baseUrl: string, token: string, id: string): Promise<Device> {
  return fetchJson(baseUrl, `/devices/${id}`, DeviceSchema, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateDevice(
  baseUrl: string,
  token: string,
  id: string,
  body: DeviceUpdate,
): Promise<Device> {
  const parsed = DeviceUpdateSchema.parse(body);
  return fetchJson(baseUrl, `/devices/${id}`, DeviceSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function setPrimaryDevice(
  baseUrl: string,
  token: string,
  id: string,
): Promise<Device> {
  return fetchJson(baseUrl, `/devices/${id}/primary`, DeviceSchema, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function updateDevicePushToken(
  baseUrl: string,
  token: string,
  id: string,
  body: DevicePushToken,
): Promise<Device> {
  return fetchJson(baseUrl, `/devices/${id}/push-token`, DeviceSchema, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function revokeDevice(baseUrl: string, token: string, id: string): Promise<Device> {
  return fetchJson(baseUrl, `/devices/${id}/revoke`, DeviceSchema, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendTestNotification(
  baseUrl: string,
  token: string,
  id: string,
): Promise<{ queued: true }> {
  return fetchJson(baseUrl, `/devices/${id}/test-notification`, TestNotificationResponseSchema, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
