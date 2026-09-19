import { useDeviceIdentity } from "@/device-identity/provider";
import { showToast } from "@/components/ui/toast";

// The paired device's bearer token, for the routes ADR-082 bound to it
// (Checkpoint 10.9): approve, cancel, every permission change and every
// owner-side agent route. The token is read from the DeviceIdentityProvider,
// never from SecureStore on each call (the queries/devices.ts idiom).
//
// When there is no token the hooks that read are `enabled: false` and the
// mutations refuse BEFORE any network call with `NotPairedError`; the
// mutation's own `onError` maps that one error to a toast so a caller that
// forgot to gate its button still tells the owner what to do. Nothing here
// stores, copies or logs the token.

export const NOT_PAIRED_MESSAGE = "not_paired";

/** The toast an unpaired device sees when it taps a device-bound write. */
export const NOT_PAIRED_TOAST = "Pair this device first";

export class NotPairedError extends Error {
  constructor() {
    super(NOT_PAIRED_MESSAGE);
    this.name = "NotPairedError";
  }
}

export function isNotPairedError(error: unknown): boolean {
  return error instanceof Error && error.message === NOT_PAIRED_MESSAGE;
}

/** The bearer or a thrown `NotPairedError` -- called inside a mutationFn so the refusal is the mutation's error. */
export function requireDeviceToken(token: string | null): string {
  if (token === null) throw new NotPairedError();
  return token;
}

/** A mutation `onError`: the one toast for the one refusal this module makes. Every other error is the caller's. */
export function toastIfNotPaired(error: unknown): void {
  if (isNotPairedError(error)) showToast({ message: NOT_PAIRED_TOAST, tone: "danger" });
}

export function useDeviceToken(): string | null {
  return useDeviceIdentity().identity?.token ?? null;
}
