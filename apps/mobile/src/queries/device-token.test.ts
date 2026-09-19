import { beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "@/components/ui/toast";
import {
  NOT_PAIRED_TOAST,
  NotPairedError,
  isNotPairedError,
  requireDeviceToken,
  toastIfNotPaired,
} from "./device-token";

// The one refusal the device-bound hooks make (Checkpoint 10.9, ADR-082):
// no token, no network call, one toast.

vi.mock("@/components/ui/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireDeviceToken", () => {
  it("returns the token, or throws the not-paired error before anything is sent", () => {
    expect(requireDeviceToken("posd_abc")).toBe("posd_abc");
    expect(() => requireDeviceToken(null)).toThrow(NotPairedError);
    expect(isNotPairedError(new NotPairedError())).toBe(true);
    expect(isNotPairedError(new Error("network"))).toBe(false);
  });
});

describe("toastIfNotPaired", () => {
  it("toasts Pair this device first for the not-paired error only", () => {
    toastIfNotPaired(new Error("network"));
    expect(showToast).not.toHaveBeenCalled();
    toastIfNotPaired(new NotPairedError());
    expect(showToast).toHaveBeenCalledWith({ message: NOT_PAIRED_TOAST, tone: "danger" });
    expect(NOT_PAIRED_TOAST).toBe("Pair this device first");
  });
});
