import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Minimal hooks harness --------------------------------------------------
// Same rationale and shape as use-reminder-reconciliation.test.ts's own
// harness (this repo has no React renderer installed for tests) -- extended
// with the one extra primitive useCaptureShortcutNotification calls that
// hook doesn't need: useCallback, memoized by deps exactly like React's real
// contract. That matters here: the effect below depends on the callback's
// IDENTITY, so a non-memoizing stub would make it look like it re-subscribes
// every render regardless of whether isPaired actually changed.
//
// This file asserts through the NATIVE boundary (expo-notifications), not by
// mocking this module's own exports -- the hook, `postCaptureShortcutNotification`
// and `clearCaptureShortcutNotification` all live in one module, and a same-
// module `vi.spyOn` does not reliably intercept an internal call to a
// function referenced by its own local binding rather than through the
// module namespace object. Asserting on `scheduleNotificationAsync` /
// `getPresentedNotificationsAsync` / `dismissNotificationAsync` directly
// sidesteps that entirely and is the same choice the sibling
// use-capture-shortcut-notification.test.ts already makes.
const hooksHarness = vi.hoisted(() => {
  const callbackSlots = new Map<number, { fn: unknown; deps: readonly unknown[] }>();
  const effectDeps = new Map<number, readonly unknown[] | undefined>();
  const effectCleanups = new Map<number, (() => void) | undefined>();
  let index = 0;

  function reset(): void {
    callbackSlots.clear();
    effectDeps.clear();
    effectCleanups.clear();
    index = 0;
  }

  function beginRender(): void {
    index = 0;
  }

  function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
  }

  function useCallback<T>(fn: T, deps: readonly unknown[]): T {
    const idx = index++;
    const existing = callbackSlots.get(idx);
    if (existing && depsEqual(existing.deps, deps)) return existing.fn as T;
    callbackSlots.set(idx, { fn, deps });
    return fn;
  }

  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const idx = index++;
    const isFirstRun = !effectDeps.has(idx);
    const prevDeps = effectDeps.get(idx);
    const changed =
      isFirstRun || deps === undefined || prevDeps === undefined || !depsEqual(deps, prevDeps);
    effectDeps.set(idx, deps);
    if (!changed) return;
    const prevCleanup = effectCleanups.get(idx);
    if (prevCleanup) prevCleanup();
    const cleanup = effect();
    effectCleanups.set(idx, typeof cleanup === "function" ? cleanup : undefined);
  }

  return { reset, beginRender, useCallback, useEffect };
});

vi.mock("react", () => ({
  useCallback: hooksHarness.useCallback,
  useEffect: hooksHarness.useEffect,
}));

const reactNativeMock = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    platform: { os: "android" as string },
    listeners,
    fireChange(state: string): void {
      for (const cb of listeners) cb(state);
    },
  };
});
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return reactNativeMock.platform.os;
    },
  },
  AppState: {
    addEventListener: vi.fn((_event: string, cb: (state: string) => void) => {
      reactNativeMock.listeners.add(cb);
      return { remove: () => reactNativeMock.listeners.delete(cb) };
    }),
  },
}));

const deviceIdentityMock = vi.hoisted(() => ({ useDeviceIdentity: vi.fn() }));
vi.mock("@/device-identity/provider", () => ({
  useDeviceIdentity: deviceIdentityMock.useDeviceIdentity,
}));

const {
  setNotificationChannelAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
} = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(),
  dismissNotificationAsync: vi.fn(),
}));
vi.mock("expo-notifications", () => ({
  setNotificationChannelAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  getPresentedNotificationsAsync,
  dismissNotificationAsync,
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

const { useCaptureShortcutNotification } = await import("./use-capture-shortcut-notification");

function render(): void {
  hooksHarness.beginRender();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useCaptureShortcutNotification();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function paired() {
  return { identity: { token: "t", deviceId: "d" } };
}
function unpaired() {
  return { identity: null };
}

describe("useCaptureShortcutNotification pairing gate (Checkpoint 9.1, Finding 3)", () => {
  beforeEach(() => {
    hooksHarness.reset();
    reactNativeMock.platform.os = "android";
    reactNativeMock.listeners.clear();
    deviceIdentityMock.useDeviceIdentity.mockReset();
    setNotificationChannelAsync.mockReset().mockResolvedValue(undefined);
    getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
    scheduleNotificationAsync.mockReset().mockResolvedValue("scheduled");
    getPresentedNotificationsAsync.mockReset().mockResolvedValue([]);
    dismissNotificationAsync.mockReset().mockResolvedValue(undefined);
  });

  it("posts the shortcut when the device IS paired", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(paired());

    render();
    await flush();

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("never posts, and proactively clears, when the device is NOT paired", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(unpaired());
    getPresentedNotificationsAsync.mockResolvedValue([
      { request: { identifier: "stale-1", content: { data: { captureShortcut: true } } } },
    ]);

    render();
    await flush();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(dismissNotificationAsync).toHaveBeenCalledWith("stale-1");
  });

  it("clears the shortcut on the render AFTER the device becomes unpaired (e.g. Forget device)", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(paired());
    render();
    await flush();
    scheduleNotificationAsync.mockClear();
    getPresentedNotificationsAsync.mockResolvedValue([
      { request: { identifier: "was-showing", content: { data: { captureShortcut: true } } } },
    ]);

    deviceIdentityMock.useDeviceIdentity.mockReturnValue(unpaired());
    render();
    await flush();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(dismissNotificationAsync).toHaveBeenCalledWith("was-showing");
  });

  it("reposts on an AppState foreground transition while paired", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(paired());
    render();
    await flush();
    scheduleNotificationAsync.mockClear();

    reactNativeMock.fireChange("active");
    await flush();

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("re-clears (never posts) on a foreground transition while unpaired", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(unpaired());
    render();
    await flush();
    getPresentedNotificationsAsync.mockClear();

    reactNativeMock.fireChange("active");
    await flush();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(getPresentedNotificationsAsync).toHaveBeenCalled();
  });

  it("ignores a background transition (only 'active' triggers a re-check)", async () => {
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(paired());
    render();
    await flush();
    scheduleNotificationAsync.mockClear();

    reactNativeMock.fireChange("background");
    await flush();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("does nothing on web, paired or not", async () => {
    reactNativeMock.platform.os = "web";
    deviceIdentityMock.useDeviceIdentity.mockReturnValue(paired());

    render();
    await flush();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(getPresentedNotificationsAsync).not.toHaveBeenCalled();
  });
});
