import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Notifications from "expo-notifications";

// --- Minimal hooks harness --------------------------------------------------
// Same shape as use-capture-shortcut-notification.hook.test.ts (no React
// renderer in this repo). useNotificationLifecycle calls useRouter and
// usePathname (mocked below, so navigation is observable), useEffect and
// useRef only.
//
// This file exists for ONE property that use-notification-lifecycle.test.ts
// cannot cover, because that file drives handleNotificationResponse
// directly: the hook's WIRING. Checkpoint 9.4 replaced
// `useLastNotificationResponse` with a mount-time
// `getLastNotificationResponseAsync()` plus a live
// `addNotificationResponseReceivedListener`, because the expo hook collapses
// two responses sharing a request identifier (its `determineNextResponse`)
// and would swallow the second action button on one reminder. The tests
// below assert through the expo-notifications boundary that both sources
// reach the handler, that a remount cannot double-run an action, and that
// web touches neither.
const hooksHarness = vi.hoisted(() => {
  const effectDeps = new Map<number, readonly unknown[] | undefined>();
  const effectCleanups = new Map<number, (() => void) | undefined>();
  const refs = new Map<number, { current: unknown }>();
  let index = 0;
  let refIndex = 0;

  function reset(): void {
    effectDeps.clear();
    effectCleanups.clear();
    refs.clear();
    index = 0;
    refIndex = 0;
  }

  function beginRender(): void {
    index = 0;
    refIndex = 0;
  }

  function unmount(): void {
    for (const cleanup of effectCleanups.values()) cleanup?.();
    effectDeps.clear();
    effectCleanups.clear();
    refs.clear();
  }

  // The same object across renders, initialised once -- what the hook needs
  // of useRef to hold the latest pathname for the listener.
  function useRef<T>(initial: T): { current: T } {
    const idx = refIndex++;
    let ref = refs.get(idx);
    if (!ref) {
      ref = { current: initial };
      refs.set(idx, ref);
    }
    return ref as { current: T };
  }

  function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
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

  return { reset, beginRender, unmount, useEffect, useRef };
});

vi.mock("react", () => ({ useEffect: hooksHarness.useEffect, useRef: hooksHarness.useRef }));

// Replaces the vitest alias mock (src/__mocks__/expo-router.ts), whose
// router has no canDismiss/dismissAll/navigate: navigation must be
// observable here, and the pathname must be settable per render.
const routerMock = vi.hoisted(() => ({
  pathname: "/",
  router: {
    canDismiss: vi.fn(() => false),
    dismissAll: vi.fn(),
    navigate: vi.fn(),
  },
}));
vi.mock("expo-router", () => ({
  useRouter: () => routerMock.router,
  usePathname: () => routerMock.pathname,
}));

const reactNativeMock = vi.hoisted(() => ({ platform: { os: "android" as string } }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return reactNativeMock.platform.os;
    },
  },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

const notificationsMock = vi.hoisted(() => {
  const listeners = new Set<(response: unknown) => void>();
  return {
    listeners,
    addNotificationResponseReceivedListener: vi.fn((listener: (response: unknown) => void) => {
      listeners.add(listener);
      return { remove: vi.fn(() => listeners.delete(listener)) };
    }),
    getLastNotificationResponseAsync: vi.fn(),
    setNotificationHandler: vi.fn(),
    dismissNotificationAsync: vi.fn().mockResolvedValue(undefined),
    getAllScheduledNotificationsAsync: vi.fn().mockResolvedValue([]),
    cancelScheduledNotificationAsync: vi.fn().mockResolvedValue(undefined),
    fire(response: unknown): void {
      for (const listener of listeners) listener(response);
    },
  };
});
vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: notificationsMock.addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync: notificationsMock.getLastNotificationResponseAsync,
  setNotificationHandler: notificationsMock.setNotificationHandler,
  dismissNotificationAsync: notificationsMock.dismissNotificationAsync,
  getAllScheduledNotificationsAsync: notificationsMock.getAllScheduledNotificationsAsync,
  cancelScheduledNotificationAsync: notificationsMock.cancelScheduledNotificationAsync,
  setNotificationChannelAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  getPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: vi.fn(),
  getPresentedNotificationsAsync: vi.fn().mockResolvedValue([]),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

// The REAL deps the hook binds: the api client and query client. Stubbed so
// an action delivered through the hook's own wiring reaches a countable
// `completeOccurrence`.
const apiMock = vi.hoisted(() => ({
  completeOccurrence: vi.fn().mockResolvedValue({}),
  completeTask: vi.fn(),
  snoozeOccurrence: vi.fn(),
  getTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("@/queries/client", () => ({
  api: apiMock,
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/device-identity/paired-state", () => ({ isDeviceIdentityPaired: () => true }));
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));

const { useNotificationLifecycle, resetHandledNotificationResponsesForTest } =
  await import("./use-notification-lifecycle");

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";
const AT = "2026-08-18T09:00:00.000Z";

function makeResponse(
  identifier: string,
  actionIdentifier: string,
): Notifications.NotificationResponse {
  return {
    notification: {
      date: Date.now(),
      request: {
        identifier,
        content: {
          data: { key: `occ:${OCC_ID}`, taskId: TASK_ID, occurrenceId: OCC_ID, remindAt: AT },
        } as unknown as Notifications.NotificationContent,
        trigger: null as unknown as Notifications.NotificationTrigger,
      },
    },
    actionIdentifier,
  } as Notifications.NotificationResponse;
}

function render(): void {
  hooksHarness.beginRender();
  // Drives the fake hooks harness directly -- not a real component.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useNotificationLifecycle();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// The real post-action cleanup (dismiss, the scheduler's serialized
// cancel-by-key, the invalidations) is several awaits deep before the
// navigation step runs; a fixed handful of ticks is not enough.
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

beforeEach(() => {
  hooksHarness.reset();
  resetHandledNotificationResponsesForTest();
  notificationsMock.listeners.clear();
  notificationsMock.addNotificationResponseReceivedListener.mockClear();
  notificationsMock.getLastNotificationResponseAsync.mockReset().mockResolvedValue(null);
  notificationsMock.setNotificationHandler.mockClear();
  notificationsMock.dismissNotificationAsync.mockClear();
  apiMock.completeOccurrence.mockClear().mockResolvedValue({});
  routerMock.pathname = "/";
  routerMock.router.canDismiss.mockClear();
  routerMock.router.dismissAll.mockClear();
  routerMock.router.navigate.mockClear();
  reactNativeMock.platform.os = "android";
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("useNotificationLifecycle wiring (Checkpoint 9.4)", () => {
  it("on mount reads the launching response once AND subscribes a live listener", async () => {
    render();
    await flush();

    expect(notificationsMock.getLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
    expect(notificationsMock.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    expect(notificationsMock.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it("COLD START: an action button that launched the process is acted on from the mount-time read", async () => {
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(
      makeResponse("reminder-cold", "complete"),
    );

    render();
    await flush();

    expect(apiMock.completeOccurrence).toHaveBeenCalledTimes(1);
    expect(apiMock.completeOccurrence).toHaveBeenCalledWith(OCC_ID);
  });

  it("WARM: an action delivered through the response listener is acted on", async () => {
    render();
    await flush();

    notificationsMock.fire(makeResponse("reminder-warm", "complete"));
    await flush();

    expect(apiMock.completeOccurrence).toHaveBeenCalledTimes(1);
  });

  it("a second, DIFFERENT action on the same notification is not collapsed (the reason useLastNotificationResponse is gone)", async () => {
    render();
    await flush();

    notificationsMock.fire(makeResponse("reminder-same", "snooze_hour"));
    await flush();
    notificationsMock.fire(makeResponse("reminder-same", "complete"));
    await flush();

    expect(apiMock.snoozeOccurrence).toHaveBeenCalledTimes(1);
    expect(apiMock.completeOccurrence).toHaveBeenCalledTimes(1);
  });

  it("the cold response arriving AGAIN on the listener, or on a remount's re-read, runs the action exactly once", async () => {
    const response = makeResponse("reminder-dup", "complete");
    notificationsMock.getLastNotificationResponseAsync.mockResolvedValue(response);

    render();
    await flush();
    notificationsMock.fire(response);
    await flush();

    // Remount: cleanup, then a fresh mount re-reads the last response.
    hooksHarness.unmount();
    hooksHarness.reset();
    render();
    await flush();

    expect(notificationsMock.getLastNotificationResponseAsync).toHaveBeenCalledTimes(2);
    expect(apiMock.completeOccurrence).toHaveBeenCalledTimes(1);
  });

  it("navigates to the task after an action, from any other screen", async () => {
    render();
    await flush();

    notificationsMock.fire(makeResponse("reminder-nav", "complete"));
    await settle();

    expect(routerMock.router.navigate).toHaveBeenCalledWith(`/tasks/${TASK_ID}`);
  });

  it("does NOT navigate when the task's own screen is already showing -- the pathname the LATEST render supplied, read when the action resolves", async () => {
    render();
    await flush();

    // A later render (the owner opened the task) updates the pathname the
    // still-subscribed listener reads; the listener itself is not re-registered.
    routerMock.pathname = `/tasks/${TASK_ID}`;
    render();
    expect(notificationsMock.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);

    notificationsMock.fire(makeResponse("reminder-here", "complete"));
    await settle();

    expect(apiMock.completeOccurrence).toHaveBeenCalledTimes(1);
    expect(notificationsMock.dismissNotificationAsync).toHaveBeenCalled();
    expect(routerMock.router.dismissAll).not.toHaveBeenCalled();
    expect(routerMock.router.navigate).not.toHaveBeenCalled();
  });

  it("unmount removes the listener, so a response after unmount reaches nothing", async () => {
    render();
    await flush();
    expect(notificationsMock.listeners.size).toBe(1);

    hooksHarness.unmount();
    expect(notificationsMock.listeners.size).toBe(0);
  });

  it("a mount-time read that rejects is contained (web-like runtimes without the emitter module)", async () => {
    notificationsMock.getLastNotificationResponseAsync.mockRejectedValue(
      new Error("UnavailabilityError"),
    );

    render();
    await flush();

    expect(apiMock.completeOccurrence).not.toHaveBeenCalled();
  });

  it("on web neither the read nor the listener is touched", async () => {
    reactNativeMock.platform.os = "web";

    render();
    await flush();

    expect(notificationsMock.getLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(notificationsMock.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(notificationsMock.setNotificationHandler).not.toHaveBeenCalled();
  });
});
