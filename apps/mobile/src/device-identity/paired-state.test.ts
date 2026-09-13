import { beforeEach, describe, expect, it } from "vitest";
import { isDeviceIdentityPaired, setDeviceIdentityPaired } from "./paired-state";

describe("paired-state", () => {
  beforeEach(() => {
    setDeviceIdentityPaired(false);
  });

  it("defaults to (and can be reset to) unpaired", () => {
    expect(isDeviceIdentityPaired()).toBe(false);
  });

  it("reflects whatever was last set, synchronously", () => {
    setDeviceIdentityPaired(true);
    expect(isDeviceIdentityPaired()).toBe(true);

    setDeviceIdentityPaired(false);
    expect(isDeviceIdentityPaired()).toBe(false);
  });
});
