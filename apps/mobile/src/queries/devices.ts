import type { DeviceListParams } from "@personal-os/api-client";
import type { DeviceRegister, DeviceUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeviceIdentity } from "@/device-identity/provider";
import { api } from "./client";

// registerDevice needs no token (it's the Tailscale-only, pairing-code-gated
// bootstrap call -- see apps/api/src/routes/devices.ts). Every other device
// call requires this device's own bearer token, read from the
// DeviceIdentityProvider rather than SecureStore directly on each call.
export function useRegisterDevice() {
  return useMutation({
    mutationFn: (body: DeviceRegister) => api.registerDevice(body),
  });
}

function useDeviceToken(): string | null {
  return useDeviceIdentity().identity?.token ?? null;
}

function useInvalidateDevices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["devices"] });
}

export function useDevices(params: DeviceListParams = {}) {
  const token = useDeviceToken();
  return useQuery({
    queryKey: ["devices", params],
    queryFn: () => api.listDevices(token!, params),
    enabled: token !== null,
  });
}

export function useUpdateDevice() {
  const token = useDeviceToken();
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeviceUpdate }) => api.updateDevice(token!, id, body),
    onSuccess: invalidate,
  });
}

export function useSetPrimaryDevice() {
  const token = useDeviceToken();
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: (id: string) => api.setPrimaryDevice(token!, id),
    onSuccess: invalidate,
  });
}

export function useRevokeDevice() {
  const token = useDeviceToken();
  const invalidate = useInvalidateDevices();
  return useMutation({
    mutationFn: (id: string) => api.revokeDevice(token!, id),
    onSuccess: invalidate,
  });
}
